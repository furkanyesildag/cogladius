/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        /* Kinetic Ledger surface hierarchy */
        "kl-base":     "#0d0d18",
        "kl-surface":  "#12121e",
        "kl-low":      "#1b1a26",
        "kl-mid":      "#1f1e2a",
        "kl-high":     "#292935",
        "kl-top":      "#343440",

        /* Accent */
        "kl-orange":   "#ff5625",
        "kl-orange-soft": "#ffb5a0",
        "kl-on-orange": "#541100",

        /* Semantic */
        "kl-green":    "#40e183",
        "kl-amber":    "#e8a020",
        "kl-blue":     "#adc6ff",
        "kl-blue-container": "#0566d9",
        "kl-red":      "#ffb4ab",
        "kl-red-dark": "#93000a",

        /* Text */
        "kl-text":     "#e3e0f1",
        "kl-muted":    "#6b6a7a",

        /* Legacy arena tokens (CSS-variable backed) */
        arena: {
          bg:      "var(--bg-base)",
          card:    "var(--bg-surface)",
          border:  "var(--bg-border)",
          lobster: "var(--accent)",
          green:   "var(--green)",
          orange:  "var(--yellow)",
          muted:   "var(--text-muted)",
          dim:     "var(--text-ghost)",
        },
      },
      fontFamily: {
        headline: ["Space Grotesk", "sans-serif"],
        body:     ["Inter", "sans-serif"],
        mono:     ["JetBrains Mono", "Fira Code", "Consolas", "monospace"],
        label:    ["JetBrains Mono", "monospace"],
      },
      borderRadius: {
        DEFAULT: "2px",
        sm: "3px",
        md: "4px",
        lg: "6px",
        xl: "8px",
        "2xl": "12px",
        full: "9999px",
      },
      animation: {
        "pulse-ring":   "pulse-ring 2s cubic-bezier(0, 0, 0.2, 1) infinite",
        "fade-in":      "fadeIn 0.25s ease",
        "slide-in":     "slideIn 0.3s ease-out",
        "modal-in":     "modalIn 0.25s cubic-bezier(0.34, 1.56, 0.64, 1)",
        "ticker":       "ticker-scroll 30s linear infinite",
        "tx-flash":     "txFlash 1.5s ease-out",
      },
      keyframes: {
        "pulse-ring": {
          "0%":   { transform: "scale(0.8)", opacity: "0.8" },
          "100%": { transform: "scale(2.4)", opacity: "0" },
        },
        fadeIn: {
          from: { opacity: "0", transform: "translateY(-4px)" },
          to:   { opacity: "1", transform: "translateY(0)" },
        },
        slideIn: {
          from: { opacity: "0", transform: "translateX(-8px)" },
          to:   { opacity: "1", transform: "translateX(0)" },
        },
        modalIn: {
          from: { opacity: "0", transform: "scale(0.96) translateY(8px)" },
          to:   { opacity: "1", transform: "scale(1) translateY(0)" },
        },
        "ticker-scroll": {
          "0%":   { transform: "translateX(0)" },
          "100%": { transform: "translateX(-50%)" },
        },
        txFlash: {
          "0%":   { background: "rgba(64, 225, 131, 0.1)" },
          "100%": { background: "transparent" },
        },
      },
      boxShadow: {
        lobster:    "0 0 20px rgba(255, 86, 37, 0.25)",
        "lobster-sm": "0 0 8px rgba(255, 86, 37, 0.15)",
        green:      "0 0 16px rgba(64, 225, 131, 0.25)",
        card:       "0 4px 24px rgba(0, 0, 0, 0.4)",
        modal:      "0 8px 48px rgba(0, 0, 0, 0.6), 0 0 40px 2px rgba(255, 86, 37, 0.04)",
      },
    },
  },
  plugins: [],
};
