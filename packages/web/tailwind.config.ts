import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["var(--font-geist-sans)", "system-ui", "sans-serif"],
        mono: ["var(--font-geist-mono)", "monospace"],
      },
      colors: {
        surface: {
          DEFAULT: "#0f0f0f",
          "1": "#1a1a1a",
          "2": "#242424",
          "3": "#2e2e2e",
        },
        accent: { DEFAULT: "#6366f1", hover: "#818cf8" },
        muted: "#6b7280",
        border: "#2e2e2e",
      },
    },
  },
  plugins: [],
};

export default config;
