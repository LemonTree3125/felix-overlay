# felix-overlay

Desktop overlay ("smart wallpaper") scaffold using Electron + React + TypeScript.

## What this scaffold implements

- Frameless, transparent, full-screen overlay window (primary display).
- Click-through transparency using `BrowserWindow.setIgnoreMouseEvents(true, { forward: true })`.
- Interactive widgets: when the React app detects hover over a widget, it tells the main process to temporarily re-enable mouse events.
- System tray menu with **Open Settings** and **Quit**.

## Install / Run

```bash
npm install
npm run dev
```

## Key files

- Overlay window + tray: [electron/main.ts](electron/main.ts)
- Preload IPC bridge: [electron/preload.ts](electron/preload.ts)
- Hover detection + widget grid: [src/renderer/App.tsx](src/renderer/App.tsx)

## Click-through logic (critical)

The core pattern is:

- Main process starts the overlay in click-through mode:
	- `win.setIgnoreMouseEvents(true, { forward: true })`
	- Clicks go to the desktop; mouse move is still forwarded so the renderer can detect hovering.
- Renderer sends `overlay:set-widget-hovering`:
	- Hovering a widget → main calls `win.setIgnoreMouseEvents(false)`
	- Hovering empty space → main calls `win.setIgnoreMouseEvents(true, { forward: true })`

That logic is implemented in [electron/main.ts](electron/main.ts).

## Z-order / wallpaper attachment notes

Electron alone can’t reliably pin a BrowserWindow behind desktop icons on Windows with pure JS.
This scaffold sets `type: 'desktop'` (best-effort), but true wallpaper attachment typically needs native code:

- Windows (WorkerW technique): enumerate windows, send `0x052C` to Progman to spawn WorkerW, then re-parent the Electron HWND to the WorkerW window so it sits at wallpaper level.
	- Practically: use a native addon (C++/N-API) or a maintained helper library that can fetch the HWND and call Win32 APIs (`FindWindow`, `FindWindowEx`, `SendMessageTimeout`, `SetParent`).
- macOS: use window levels and collection behaviors to position relative to desktop; true “desktop layer” behavior can still be constrained by macOS window server rules.

If you tell me your target OS (Windows-only vs cross-platform), I can wire up the correct native strategy.

## Dependencies

- `electron`
- `react`, `react-dom`
- `typescript`
- `vite`, `@vitejs/plugin-react`
- `electron-vite`
- Types: `@types/node`, `@types/react`, `@types/react-dom`
