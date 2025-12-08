import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],

  resolve: {
    alias: {
      // If your tests import from the app, this helps:
      '@': resolve(__dirname, 'src'),
    },
  },
  test: {
    // Tell Vitest where your tests live
    include: [
      // Default patterns inside app (optional)
      'src/**/*.{test,spec}.{js,ts,jsx,tsx}',
      // Your external test folder, adjust path as needed:
      '../../tests/**/*.{js,ts,jsx,tsx}',

    ],
    globals: true,
    environment: 'jsdom',
  },
})