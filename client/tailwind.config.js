/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: { DEFAULT: "#FF3B30", dark: "#CC2F26", light: "#FF6B65" },
        ink: "#0F0F12",
        surface: "#1A1A1E",
      },
      fontFamily: { display: ["Space Grotesk", "system-ui", "sans-serif"] },
    },
  },
  plugins: [],
};
