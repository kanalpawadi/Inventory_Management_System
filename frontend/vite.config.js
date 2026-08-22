import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],

  server: {
    port: 5173,
    proxy: {
      '/forecast':  'http://localhost:8000',
      '/inventory': 'http://localhost:8000',
      '/anomalies': 'http://localhost:8000',
      '/explain':   'http://localhost:8000',
      '/chat':      'http://localhost:8000',
    }
  },

  build: {
    // Split vendor chunks to keep main bundle ≤500KB
    rollupOptions: {
      output: {
        manualChunks: {
          'react-vendor':    ['react', 'react-dom'],
          'charts':          ['recharts'],
          'utils':           ['date-fns', 'axios'],
          'icons':           ['lucide-react'],
        }
      }
    },
    // Raise warning threshold slightly (recharts is inherently large)
    chunkSizeWarningLimit: 600,
  }
})
