/// <reference types="vite/client" />

declare global {
  interface Window {
    overlay: {
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
      getSystemUsage: () => Promise<{
        cpuPercent: number | null
        memoryPercent: number | null
        gpuPercent: number | null
        updatedAt: number
      }>
      onOpenSettings: (handler: () => void) => () => void
    }
  }
}

export {}
