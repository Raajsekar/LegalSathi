module.exports = {
  content: ["./index.html", "./src/**/*.{js,jsx,ts,tsx}"],
  theme: {
    extend: {
      colors: {
        background: "#0A0A0D",
        surface: "#111122",
        accent: "#6366F1", // indigo-500
        accent2: "#8B5CF6", // purple-500
      },
      animation: {
        fadeIn: "fadeIn 0.6s ease-in-out",
        pulseSlow: "pulseSlow 2s ease-in-out infinite",
      },
      keyframes: {
        fadeIn: {
          "0%": { opacity: 0 },
          "100%": { opacity: 1 },
        },
        pulseSlow: {
          "0%, 100%": { opacity: 1 },
          "50%": { opacity: 0.4 },
        },
      },
      boxShadow: {
        glow: "0 0 15px rgba(99, 102, 241, 0.5)",
      },
    },
  },
  plugins: [],
};
