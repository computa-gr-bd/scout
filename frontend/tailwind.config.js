/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx,js,jsx}"],
  theme: {
    extend: {
      colors: {
        sv: {
          bg: "#0a0f1a",
          panel: "#111a2b",
          panel2: "#16203a",
          border: "#22314f",
          accent: "#2f8f6b",
          accent2: "#37b486",
          accent3: "#5ef2b8",
          danger: "#e1534e",
          warn: "#f2a64c",
          text: "#e6eaf2",
          muted: "#8794ad",
          pitch: "#1e7b4b",
          pitchDark: "#145e38",
          pitchLine: "rgba(255,255,255,0.85)",
        },
      },
      fontFamily: {
        sans: ["Inter", "ui-sans-serif", "system-ui", "-apple-system", "Segoe UI", "Roboto"],
        mono: ["JetBrains Mono", "ui-monospace", "SFMono-Regular"],
      },
      boxShadow: {
        glow: "0 0 0 1px rgba(55,180,134,0.35), 0 10px 40px -12px rgba(55,180,134,0.25)",
      },
    },
  },
  plugins: [],
};
