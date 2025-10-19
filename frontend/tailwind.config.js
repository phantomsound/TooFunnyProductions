// frontend/tailwind.config.cjs
/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
   theme: {
    extend: {
      colors: {
        brandDark: "#0a0a0a",
        brandPrimary: "#1a1a40",
        brandAccent: "#ffcc00",
      },
    },
  },
  plugins: [],
};
