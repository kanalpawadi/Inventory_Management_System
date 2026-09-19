import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Dev proxy target — override with API_PROXY=http://localhost:8010 if 8000 is taken
const API = process.env.API_PROXY || 'http://localhost:8000'

export default defineConfig({
  plugins: [react()],

  server: {
    port: 5173,
    // DEV-ONLY proxy: routes API paths to the local backend.
    // In production, VITE_API_URL (Render env var / .env.production) points to the API.
    proxy: {
      '/forecast':  API,
      '/inventory': API,
      '/anomalies': API,
      '/explain':   API,
      '/chat':      API,
      '/health':    API,
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
