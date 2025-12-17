import { app, BrowserWindow, ipcMain, Menu, screen, Tray, nativeImage } from 'electron'
import { exec } from 'node:child_process'
import { promisify } from 'node:util'
import fs from 'node:fs'
import { join, resolve } from 'node:path'

const execAsync = promisify(exec)

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null

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
  
  // macOS bug: setIgnoreMouseEvents with forward:true doesn't forward mousemove to renderer
  // Solution: On macOS, always disable ignore when we need mouse tracking (even for click-through)
  if (process.platform === 'darwin') {
    // On macOS, we can't use forward:true reliably, so we make the window interactive
    // The renderer will handle making non-widget areas feel click-through via CSS pointer-events
    win.setIgnoreMouseEvents(false)
  } else {
    if (clickThrough) {
      win.setIgnoreMouseEvents(true, { forward: true })
    } else {
      win.setIgnoreMouseEvents(false)
    }
  }
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
  
  // On macOS, prevent the window from activating/focusing but keep it responsive
  if (process.platform === 'darwin') {
    win.setAlwaysOnTop(true, 'floating', 1)
    // Enable mouse tracking without capturing focus
    win.setVisibleOnAllWorkspaces(true)
  }

  // NOTE: Electron cannot reliably force "bottom-most" on Windows via JS alone.
  // This is best-effort; see README for WorkerW approach.

  win.once('ready-to-show', () => {
    win.showInactive()
  })

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
  // Required by your spec: use electron.screen for display size.
  // Note: screen can only be used after app is ready.

  mainWindow = createMainWindow()
  createTray()

  ipcMain.on('overlay:set-widget-hovering', (_event, hovering: boolean) => {
    if (!mainWindow || mainWindow.isDestroyed()) return
    // Hovering a widget => interactive; hovering empty space => click-through.
    setOverlayClickThrough(mainWindow, !hovering)
  })

  ipcMain.on('overlay:request-click-through', (_event, clickThrough: boolean) => {
    if (!mainWindow || mainWindow.isDestroyed()) return
    setOverlayClickThrough(mainWindow, clickThrough)
  })

  ipcMain.on('overlay:focus-window', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return
    // Allow interaction + ensure keystrokes reach the renderer (e.g., text inputs).
    setOverlayClickThrough(mainWindow, false)
    mainWindow.show()
    
    // On macOS, we need to temporarily allow the window to become active to receive keyboard input
    if (process.platform === 'darwin') {
      mainWindow.setAlwaysOnTop(true, 'pop-up-menu')
    }
    
    mainWindow.focus()
  })

  ipcMain.on('overlay:blur-window', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return
    // Restore overlay floating behavior on macOS when input loses focus
    if (process.platform === 'darwin') {
      mainWindow.setAlwaysOnTop(true, 'floating', 1)
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

app.on('window-all-closed', () => {
  // Overlay apps usually keep running in tray.
  // By registering this handler and intentionally not calling `app.quit()`,
  // we keep the process alive (tray remains available).
})
