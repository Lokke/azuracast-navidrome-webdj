import { defineConfig } from 'vite'

export default defineConfig({
  base: './',
  server: {
    proxy: {
      // Proxy all /api/* requests to unified-server
      '/api/': {
        target: 'http://localhost:3001',
        changeOrigin: true,
        secure: false
      }
    }
  }
})