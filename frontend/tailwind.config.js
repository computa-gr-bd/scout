/** @type {import('tailwindcss').Config} */
// Todas as cores/raios/fontes vêm dos tokens em src/styles/tokens.css.
const c = (v) => `rgb(var(--sv-${v}) / <alpha-value>)`;

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx,js,jsx}"],
  theme: {
    screens: { sm: "640px", md: "768px", lg: "1024px", xl: "1280px", "2xl": "1536px" },
    extend: {
      colors: {
        sv: {
          bg: c("bg"),
          panel: c("panel"),
          panel2: c("panel2"),
          panel3: c("panel3"),
          border: c("border"),
          "border-strong": c("border-strong"),
          accent: c("accent"),
          accent2: c("accent2"),
          accent3: c("accent3"),
          danger: c("danger"),
          warn: c("warn"),
          info: c("info"),
          text: c("text"),
          muted: c("muted"),
          faint: c("faint"),
          pitch: c("pitch"),
          pitchDark: c("pitch-dark"),
          pitchLine: "rgba(255,255,255,0.85)",
          // compat: usados pontualmente em PitchStudio
          accent5: "rgb(var(--sv-accent) / 0.12)",
          accent40: "rgb(var(--sv-accent3) / 0.4)",
        },
      },
      // Escala de raios moderada: todos os `rounded-*` do app passam a seguir os tokens.
      borderRadius: {
        sm: "var(--sv-r-sm)",
        DEFAULT: "var(--sv-r-sm)",
        md: "var(--sv-r-md)",
        lg: "var(--sv-r-md)",
        xl: "var(--sv-r-lg)",
        "2xl": "var(--sv-r-xl)",
        "3xl": "var(--sv-r-xl)",
      },
      fontFamily: {
        sans: ["var(--sv-font-body)"],
        display: ["var(--sv-font-display)"],
        mono: ["var(--sv-font-num)"],
      },
      boxShadow: {
        glow: "none",
        pop: "var(--sv-shadow-pop)",
      },
      transitionTimingFunction: { sv: "cubic-bezier(0.2, 0, 0, 1)" },
    },
  },
  plugins: [],
};
