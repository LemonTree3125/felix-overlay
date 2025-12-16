import { app, BrowserWindow, ipcMain, Menu, screen, Tray, nativeImage } from 'electron'
import fs from 'node:fs'
import { join, resolve } from 'node:path'

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
  if (clickThrough) {
    win.setIgnoreMouseEvents(true, { forward: true })
  } else {
    win.setIgnoreMouseEvents(false)
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
    type: 'desktop',

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

  // NOTE: Electron cannot reliably force "bottom-most" on Windows via JS alone.
  // This is best-effort; see README for WorkerW approach.

  win.once('ready-to-show', () => {
    win.showInactive()
  })

  const devUrl = process.env.ELECTRON_RENDERER_URL
  if (devUrl) {
    win.loadURL(devUrl)
    win.webContents.openDevTools({ mode: 'detach' })
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }

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
