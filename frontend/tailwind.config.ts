import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{js,ts,jsx,tsx}", "./components/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        crm: {
          void: "#050505",
          surface: "#0c0c0c",
          elevated: "#141414",
          border: "#2a2a2a",
          muted: "#a3a3a3",
          accent: "#facc15",
          "accent-hover": "#fde047",
          "accent-dim": "#ca8a04"
        }
      },
      boxShadow: {
        glow: "0 0 40px -10px rgba(250, 204, 21, 0.35)"
      }
    }
  },
  plugins: []
};

export default config;
