/// <reference types="vite/client" />

declare global {
  interface Window {
    overlay: {
      setWidgetHovering: (hovering: boolean) => void
      requestClickThrough: (clickThrough: boolean) => void
      onOpenSettings: (handler: () => void) => () => void
    }
  }
}

export {}
