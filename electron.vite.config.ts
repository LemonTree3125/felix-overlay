import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'

export default defineConfig({
  main: {
    build: {
      lib: {
        entry: resolve(__dirname, 'electron/main/index.ts')
      },
      outDir: 'dist/main'
    }
  },
  preload: {
    build: {
      lib: {
        entry: resolve(__dirname, 'electron/preload/index.ts')
      },
      outDir: 'dist/preload'
    }
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    publicDir: resolve(__dirname, 'public'),
    plugins: [react()],
    build: {
      outDir: resolve(__dirname, 'dist/renderer'),
      emptyOutDir: true
    }
  }
})
