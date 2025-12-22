import { app, BrowserWindow, ipcMain, Menu, screen, Tray, nativeImage, session, globalShortcut } from 'electron'
import { exec } from 'node:child_process'
import { promisify } from 'node:util'
import fs from 'node:fs'
import { join, resolve } from 'node:path'

const execAsync = promisify(exec)

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null

let cursorBroadcastInterval: NodeJS.Timeout | null = null
let lastCursorPayload: { x: number; y: number; inWindow: boolean } | null = null

const DEFAULT_SETTINGS_JSON = JSON.stringify(
  {
    forceFallback: false,
    theme: {
      backgroundColor: '#eeeeee',
      backgroundOpacity: 0.28,
      textColor: '#111111',
      textOpacity: 0.96
    },
    widgets: {
      big: 'clock',
      small: ['weather', 'empty', 'battery']
    }
  },
  null,
  2
)

function isDevMode() {
  return !!process.env.ELECTRON_RENDERER_URL || process.env.NODE_ENV === 'development'
}

function getSettingsFilePath() {
  if (isDevMode()) {
    // In dev, keep it convenient: read the repo-root public/settings.json so edits apply immediately.
    return join(process.cwd(), 'public', 'settings.json')
  }

  // In production, use a writable location.
  return join(app.getPath('userData'), 'settings.json')
}

async function ensureProdSettingsFileExistsBestEffort() {
  if (isDevMode()) return

  const settingsPath = getSettingsFilePath()
  try {
    await fs.promises.access(settingsPath)
  } catch {
    try {
      await fs.promises.mkdir(join(settingsPath, '..'), { recursive: true })
    } catch {
      // ignore
    }
    try {
      await fs.promises.writeFile(settingsPath, DEFAULT_SETTINGS_JSON, 'utf8')
    } catch {
      // ignore
    }
  }
}

type WidgetBounds = { left: number; top: number; width: number; height: number }

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n))
}

function applyWidgetBoundsToWindow(win: BrowserWindow, widgetBounds: WidgetBounds) {
  // The renderer reports bounds in window (CSS/DIP) coordinates.
  // We use width/height to shrink-wrap the window, but we intentionally
  // ignore left/top to avoid a feedback loop (widgets re-center after resize).
  const padding = 28

  const current = win.getBounds()
  const desiredWidth = Math.max(1, Math.round(widgetBounds.width + padding * 2))
  const desiredHeight = Math.max(1, Math.round(widgetBounds.height + padding * 2))

  const currentCenter = { x: current.x + Math.round(current.width / 2), y: current.y + Math.round(current.height / 2) }
  const display = screen.getDisplayNearestPoint(currentCenter)
  const workArea = display.workArea
  const maxWidth = workArea.width
  const maxHeight = workArea.height

  const width = clamp(desiredWidth, 1, maxWidth)
  const height = clamp(desiredHeight, 1, maxHeight)

  const x = Math.round(workArea.x + (workArea.width - width) / 2)
  const y = Math.round(workArea.y + (workArea.height - height) / 2)

  const next = { x, y, width, height }
  const delta =
    Math.abs(current.x - next.x) +
    Math.abs(current.y - next.y) +
    Math.abs(current.width - next.width) +
    Math.abs(current.height - next.height)

  // Avoid tiny jitter loops.
  if (delta < 2) return
  win.setBounds(next)
}

function configureWindowsChromiumCacheForDev() {
  const isDev = !!process.env.ELECTRON_RENDERER_URL || process.env.NODE_ENV === 'development'
  if (!isDev) return
  if (process.platform !== 'win32') return

  const baseDir = process.env.LOCALAPPDATA || process.env.TEMP || process.env.TMP
  if (!baseDir) return

  const root = resolve(join(baseDir, 'felix-overlay-dev'))
  const userDataDir = join(root, 'userData')
  const cacheDir = join(root, 'cache')

  fs.mkdirSync(userDataDir, { recursive: true })
  fs.mkdirSync(cacheDir, { recursive: true })

  // These must run before app is ready.
  app.setPath('userData', userDataDir)
  app.setPath('cache', cacheDir)
  app.commandLine.appendSwitch('disk-cache-dir', cacheDir)
  app.commandLine.appendSwitch('disable-gpu-shader-disk-cache')
  app.commandLine.appendSwitch('disable-gpu-program-cache')
}

configureWindowsChromiumCacheForDev()

// Overlay windows are often never focused (click-through), which can cause Chromium
// to throttle timers and make clocks appear to lag behind.
// These switches must be set before `app.whenReady()`.
app.commandLine.appendSwitch('disable-background-timer-throttling')
app.commandLine.appendSwitch('disable-renderer-backgrounding')

function setOverlayClickThrough(win: BrowserWindow, clickThrough: boolean) {
  // Critical behavior:
  // - clickThrough=true  => ignore clicks; forward mouse move so renderer can still detect hover.
  // - clickThrough=false => allow normal mouse interaction for widgets.
  
  // On macOS, use OS-level click-through. We drive hover/tilt without relying on
  // forwarded mousemove events.
  if (process.platform === 'darwin') {
    win.setIgnoreMouseEvents(!!clickThrough)
    return
  }

  if (clickThrough) {
    win.setIgnoreMouseEvents(true, { forward: true })
  } else {
    win.setIgnoreMouseEvents(false)
  }
}

function startCursorBroadcast(win: BrowserWindow) {
  if (cursorBroadcastInterval) return

  cursorBroadcastInterval = setInterval(() => {
    if (win.isDestroyed()) return

    const bounds = win.getBounds()
    const point = screen.getCursorScreenPoint()

    const x = point.x - bounds.x
    const y = point.y - bounds.y
    const inWindow = x >= 0 && y >= 0 && x < bounds.width && y < bounds.height

    if (lastCursorPayload && lastCursorPayload.x === x && lastCursorPayload.y === y && lastCursorPayload.inWindow === inWindow) {
      return
    }
    lastCursorPayload = { x, y, inWindow }

    win.webContents.send('overlay:cursor', { x, y, inWindow })
  }, 16)

  win.on('closed', () => {
    if (cursorBroadcastInterval) {
      clearInterval(cursorBroadcastInterval)
      cursorBroadcastInterval = null
    }
    lastCursorPayload = null
  })
}

function createMainWindow(): BrowserWindow {
  const primary = screen.getPrimaryDisplay()
  const { x, y, width, height } = primary.bounds

  const win = new BrowserWindow({
    x,
    y,
    width,
    height,

    frame: false,
    transparent: true,
    fullscreenable: false,
    resizable: false,
    movable: false,
    hasShadow: false,

    // Keep it out of taskbar and (typically) Alt+Tab.
    skipTaskbar: true,

    // Helps avoid focus stealing when it's click-through.
    show: false,

    // "desktop" is best-effort; on Windows true wallpaper pinning requires native handle tricks.
    ...(process.platform === 'win32' ? { type: 'desktop' as const } : {}),
    
    // On macOS, acceptFirstMouse allows the window to receive mouse events without becoming active
    ...(process.platform === 'darwin' ? { acceptFirstMouse: true } : {}),

    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,

      // Prevent Chromium from throttling timers when the window isn't focused.
      backgroundThrottling: false
    }
  })

  // Make sure it covers display even if DPI changes.
  win.setBounds({ x, y, width, height })

  // Start click-through by default.
  setOverlayClickThrough(win, true)

  // Helpful for overlays.
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  
  // On macOS, keep the widgets window *behind* normal app windows.
  // Electron doesn't expose a true "always-on-bottom" API, but macOS supports
  // window levels. Setting a normal level with a negative relative offset keeps
  // this window below other normal windows.
  if (process.platform === 'darwin') {
    win.setAlwaysOnTop(true, 'normal', -1)
    win.setVisibleOnAllWorkspaces(true)
    win.setFocusable(false)
  }

  // NOTE: Electron cannot reliably force "bottom-most" on Windows via JS alone.
  // This is best-effort; see README for WorkerW approach.

  win.once('ready-to-show', () => {
    win.showInactive()
  })

  startCursorBroadcast(win)

  const devUrl = process.env.ELECTRON_RENDERER_URL
  if (devUrl) {
    win.loadURL(devUrl)
    // Only open DevTools if explicitly requested via environment variable
    if (process.env.OPEN_DEVTOOLS === 'true') {
      win.webContents.openDevTools({ mode: 'detach' })
    }
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  // Suppress Autofill-related console errors from DevTools
  win.webContents.on('console-message', (event, level, message) => {
    if (message.includes('Autofill.enable') || message.includes('Autofill.setAddresses')) {
      event.preventDefault()
    }
  })

  return win
}

function createTray() {
  // Minimal embedded 1x1 PNG so the tray exists even before you supply a real icon.
  // Replace with an .ico on Windows for a proper tray icon.
  const pngBase64 =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO5X2WQAAAAASUVORK5CYII='
  const icon = nativeImage.createFromDataURL(`data:image/png;base64,${pngBase64}`)

  tray = new Tray(icon)
  tray.setToolTip('Felix Overlay')

  const menu = Menu.buildFromTemplate([
    {
      label: 'Open Settings',
      click: () => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          // Ensure the overlay becomes interactive while settings is open.
          setOverlayClickThrough(mainWindow, false)
          mainWindow.webContents.send('overlay:open-settings')
          mainWindow.showInactive()
        }
      }
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => app.quit()
    }
  ])

  tray.setContextMenu(menu)
}

app.whenReady().then(() => {
  // Allow renderer to use navigator.geolocation for local weather.
  // This app loads trusted local content only (dev server or bundled files).
  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    if (permission === 'geolocation') return callback(true)
    callback(false)
  })

  void ensureProdSettingsFileExistsBestEffort()

  ipcMain.handle('overlay:get-settings-json', async () => {
    try {
      const settingsPath = getSettingsFilePath()
      const text = await fs.promises.readFile(settingsPath, 'utf8')
      return text
    } catch (err) {
      console.warn('[settings] failed to read settings.json; returning null', err)
      return null
    }
  })

  // Required by your spec: use electron.screen for display size.
  // Note: screen can only be used after app is ready.

  mainWindow = createMainWindow()
  createTray()

  // Allow Cmd/Ctrl+R to reload the overlay even when the window isn't focusable on macOS.
  // Guard it so we only reload when the cursor is currently over the overlay window.
  const guardedReload = () => {
    if (!mainWindow || mainWindow.isDestroyed()) return
    if (lastCursorPayload && !lastCursorPayload.inWindow) return
    mainWindow.webContents.reloadIgnoringCache()
  }

  globalShortcut.register('CommandOrControl+R', guardedReload)
  globalShortcut.register('CommandOrControl+Shift+R', guardedReload)

  ipcMain.on('overlay:set-widget-hovering', (_event, hovering: boolean) => {
    if (!mainWindow || mainWindow.isDestroyed()) return
    // Hovering a widget => interactive; hovering empty space => click-through.
    setOverlayClickThrough(mainWindow, !hovering)
  })

  ipcMain.on('overlay:set-widget-bounds', (_event, bounds: WidgetBounds) => {
    if (!mainWindow || mainWindow.isDestroyed()) return
    if (
      !bounds ||
      !Number.isFinite(bounds.left) ||
      !Number.isFinite(bounds.top) ||
      !Number.isFinite(bounds.width) ||
      !Number.isFinite(bounds.height)
    ) {
      return
    }
    if (bounds.width <= 0 || bounds.height <= 0) return
    applyWidgetBoundsToWindow(mainWindow, bounds)
  })

  ipcMain.on('overlay:request-click-through', (_event, clickThrough: boolean) => {
    if (!mainWindow || mainWindow.isDestroyed()) return
    setOverlayClickThrough(mainWindow, clickThrough)
  })

  ipcMain.handle('overlay:get-battery-percentage', async () => {
    // macOS only (requested). Other platforms return null.
    if (process.platform !== 'darwin') return null

    try {
      const { stdout } = await execAsync('pmset -g batt')
      // Example output:
      // Now drawing from 'Battery Power'
      //  -InternalBattery-0 (id=1234567)\t95%; discharging; (no estimate) present: true
      const match = stdout.match(/(\d{1,3})%/)
      if (!match) return null
      const value = Number(match[1])
      if (!Number.isFinite(value)) return null
      if (value < 0 || value > 100) return null
      return value
    } catch (error) {
      console.error('Failed to get battery percentage:', error)
      return null
    }
  })

  ipcMain.handle('overlay:get-battery-info', async () => {
    // macOS only (requested). Other platforms return null.
    if (process.platform !== 'darwin') return null

    try {
      const { stdout } = await execAsync('pmset -g batt')
      const match = stdout.match(/(\d{1,3})%/)
      const percentageRaw = match ? Number(match[1]) : null
      const percentage =
        typeof percentageRaw === 'number' && Number.isFinite(percentageRaw) && percentageRaw >= 0 && percentageRaw <= 100
          ? percentageRaw
          : null

      const lower = stdout.toLowerCase()
      const powerSource: 'ac' | 'battery' | 'unknown' = lower.includes("now drawing from 'ac power'")
        ? 'ac'
        : lower.includes("now drawing from 'battery power'")
          ? 'battery'
          : 'unknown'

      let state: 'charging' | 'discharging' | 'full' | 'unknown' = 'unknown'

      // pmset status strings usually include one of: charging, discharging, charged.
      if (lower.includes('discharging')) {
        state = 'discharging'
      } else if (lower.includes('charging') || lower.includes('finishing charge')) {
        state = 'charging'
      } else if (lower.includes('charged')) {
        state = 'full'
      } else if (lower.includes("now drawing from 'ac power'")) {
        // Best-effort: when on AC and not discharging, assume charging/full.
        state = percentage === 100 ? 'full' : 'charging'
      } else if (lower.includes("now drawing from 'battery power'")) {
        // Best-effort: when on battery and not explicitly charging, assume discharging.
        state = 'discharging'
      }

      return { percentage, state, powerSource }
    } catch (error) {
      console.error('Failed to get battery info:', error)
      return { percentage: null, state: 'unknown' as const, powerSource: 'unknown' as const }
    }
  })

  ipcMain.handle('overlay:get-wallpaper-path', async () => {
    try {
      if (process.platform === 'darwin') {
        // macOS: Use osascript to get wallpaper path for each desktop
        // Try getting from System Events which is more reliable
        const { stdout } = await execAsync(
          'osascript -e \'tell application "System Events" to tell current desktop to get picture\''
        )
        const path = stdout.trim()
        // Check if it's a valid path and not empty
        if (path && path !== 'missing value' && !path.includes('error')) {
          return path
        }
        return null
      } else if (process.platform === 'win32') {
        // Windows: Get wallpaper from registry
        const { stdout } = await execAsync(
          'reg query "HKEY_CURRENT_USER\\Control Panel\\Desktop" /v Wallpaper'
        )
        const match = stdout.match(/Wallpaper\s+REG_SZ\s+(.+)/)
        return match ? match[1].trim() : null
      } else {
        // Linux: Try common paths
        return null
      }
    } catch (error) {
      console.error('Failed to get wallpaper path:', error)
      return null
    }
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createMainWindow()
    }
  })
})

app.on('will-quit', () => {
  globalShortcut.unregisterAll()
})

app.on('window-all-closed', () => {
  // Overlay apps usually keep running in tray.
  // By registering this handler and intentionally not calling `app.quit()`,
  // we keep the process alive (tray remains available).
})
