import { contextBridge, ipcRenderer } from 'electron'

export type OverlayAPI = {
  setWidgetHovering: (hovering: boolean) => void
  setWidgetBounds: (bounds: { left: number; top: number; width: number; height: number }) => void
  requestClickThrough: (clickThrough: boolean) => void
  onCursorPosition: (handler: (pos: { x: number; y: number; inWindow: boolean }) => void) => () => void
  getWallpaperPath: () => Promise<string | null>
  getBatteryPercentage: () => Promise<number | null>
  getBatteryInfo: () => Promise<{
    percentage: number | null
    state: 'charging' | 'discharging' | 'full' | 'unknown'
    powerSource: 'ac' | 'battery' | 'unknown'
  } | null>
  getSettingsJson: () => Promise<string | null>
  onOpenSettings: (handler: () => void) => () => void
}

const api: OverlayAPI = {
  setWidgetHovering: (hovering) => ipcRenderer.send('overlay:set-widget-hovering', hovering),
  setWidgetBounds: (bounds) => ipcRenderer.send('overlay:set-widget-bounds', bounds),
  requestClickThrough: (clickThrough) => ipcRenderer.send('overlay:request-click-through', clickThrough),
  onCursorPosition: (handler) => {
    const listener = (_event: Electron.IpcRendererEvent, pos: { x: number; y: number; inWindow: boolean }) => {
      handler(pos)
    }
    ipcRenderer.on('overlay:cursor', listener)
    return () => ipcRenderer.removeListener('overlay:cursor', listener)
  },
  getWallpaperPath: () => ipcRenderer.invoke('overlay:get-wallpaper-path'),
  getBatteryPercentage: () => ipcRenderer.invoke('overlay:get-battery-percentage'),
  getBatteryInfo: () => ipcRenderer.invoke('overlay:get-battery-info'),
  getSettingsJson: () => ipcRenderer.invoke('overlay:get-settings-json'),
  onOpenSettings: (handler) => {
    const listener = () => handler()
    ipcRenderer.on('overlay:open-settings', listener)
    return () => ipcRenderer.removeListener('overlay:open-settings', listener)
  }
}

contextBridge.exposeInMainWorld('overlay', api)
