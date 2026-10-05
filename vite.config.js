import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const proxyTarget = process.env.VITE_API_PROXY_TARGET || 'http://localhost:8787'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    // highlight.js and the markdown renderer only matter once a note is shown.
    chunkSizeWarningLimit: 900,
  },
  server: {
    proxy: {
      // `/s` is the short-link redirect, which the API owns rather than the SPA.
      '/api': { target: proxyTarget, changeOrigin: true },
      '/s': { target: proxyTarget, changeOrigin: true },
    },
  },
})
