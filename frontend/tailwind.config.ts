import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        saffron: { DEFAULT: "#E8762B", ink: "#B85A18", soft: "#FCE6D4", tint: "#FFF4EA" },
        navy: { DEFAULT: "#1B2A41", 700: "#26374F", body: "#46546A", muted: "#5E6A7C", line: "#DCE3EC" },
        leaf: { DEFAULT: "#1F7A4D", soft: "#E6F2EC" },
        alert: { DEFAULT: "#B42318", soft: "#FDECEA" },
        amber: { ink: "#8A5A00", soft: "#FFF3D6" },
        paper: "#FFFDF9",
        cream: "#FFF4EA",
        line: "#F0D6BF",
      },
      fontFamily: {
        display: ["var(--font-rubik)", "Arial", "sans-serif"],
        sans: ["var(--font-dm-sans)", "Arial", "sans-serif"],
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
      boxShadow: {
        card: "0 1px 2px rgba(27,42,65,0.06), 0 8px 24px rgba(27,42,65,0.06)",
        lift: "0 12px 40px rgba(27,42,65,0.12)",
      },
      keyframes: {
        pulseRing: {
          "0%": { transform: "scale(1)", opacity: "0.6" },
          "100%": { transform: "scale(1.6)", opacity: "0" },
        },
        rise: { "0%": { transform: "translateY(8px)", opacity: "0" }, "100%": { transform: "none", opacity: "1" } },
      },
      animation: {
        pulseRing: "pulseRing 1.4s ease-out infinite",
        rise: "rise 0.35s ease-out both",
      },
    },
  },
  plugins: [],
};

export default config;
