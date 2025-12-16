import { contextBridge, ipcRenderer } from 'electron'

export type OverlayAPI = {
  setWidgetHovering: (hovering: boolean) => void
  requestClickThrough: (clickThrough: boolean) => void
  onOpenSettings: (handler: () => void) => () => void
}

const api: OverlayAPI = {
  setWidgetHovering: (hovering) => ipcRenderer.send('overlay:set-widget-hovering', hovering),
  requestClickThrough: (clickThrough) => ipcRenderer.send('overlay:request-click-through', clickThrough),
  onOpenSettings: (handler) => {
    const listener = () => handler()
    ipcRenderer.on('overlay:open-settings', listener)
    return () => ipcRenderer.removeListener('overlay:open-settings', listener)
  }
}

contextBridge.exposeInMainWorld('overlay', api)
