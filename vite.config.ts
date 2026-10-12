import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'

const isElectron = process.env.ELECTRON === 'true'

export default defineConfig({
  // Relative base so packaged Electron assets resolve under the app:// protocol
  base: isElectron ? './' : '/',
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  // Ignore packaged Electron output so Vite doesn't scan release/*.html
  server: {
    // Dedicated port so Electron/wait-on don't pick up another Vite app on 5173
    port: 5174,
    strictPort: true,
    host: true,
    fs: {
      deny: ['**/release/**', '**/electron-dist/**'],
    },
    // Same-origin proxy so offline image caching can download Storage files
    // without Firebase Storage CORS (dev + electron:dev only).
    proxy: {
      '/__storage': {
        target: 'https://firebasestorage.googleapis.com',
        changeOrigin: true,
        secure: true,
        rewrite: (p) => p.replace(/^\/__storage/, ''),
      },
    },
  },
  optimizeDeps: {
    entries: ['index.html'],
  },
})
