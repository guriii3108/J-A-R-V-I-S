/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        'hologram-primary': '#ff9d1a',
        'hologram-secondary': '#ffd36b',
        'hologram-hot': '#fff3c4',
        'bg-navy': '#050b14',
      },
    },
  },
  plugins: [],
}
