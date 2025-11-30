/** @type {import('tailwindcss').Config} */
export default {
    content: [
        "./index.html",
        "./src/**/*.{js,ts,jsx,tsx}",
    ],
    theme: {
        extend: {
            colors: {
                'cabane-dark': '#1a1a1a',
                'cabane-panel': '#2d2d2d',
                'led-red': '#ef4444',
                'led-green': '#22c55e',
                'led-off': '#444444',
            },
            boxShadow: {
                'halo-red': '0 0 15px 2px rgba(239, 68, 68, 0.6)',
                'halo-green': '0 0 15px 2px rgba(34, 197, 94, 0.6)',
            }
        },
    },
    plugins: [],
}