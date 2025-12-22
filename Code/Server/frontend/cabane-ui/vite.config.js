import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],

  // ✅ Your existing alias configuration
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },

  // ✅ New build settings to fix the size warning
  build: {
    chunkSizeWarningLimit: 1000, // Increases warning threshold to 1MB
    rollupOptions: {
      output: {
        manualChunks(id) {
          // Separates third-party libs (node_modules) from your app code
          if (id.includes('node_modules')) {
            return 'vendor';
          }
        },
      },
    },
  },
})