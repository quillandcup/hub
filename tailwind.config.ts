import type { Config } from "tailwindcss";
import typography from "@tailwindcss/typography";

/**
 * Quill & Cup brand palette (from the brand guide). `plum` is the app's accent -- the
 * notification-bar plum #a64d79 at 600, with a scale around it for hover/tint/dark-mode
 * shades -- and replaces Tailwind's default blue everywhere in the UI.
 */
const plum = {
  50: "#faf3f7",
  100: "#f4e5ed",
  200: "#eacbdb",
  300: "#dca4c0",
  400: "#c7779e",
  500: "#b65a88",
  600: "#a64d79",
  700: "#8b3e64",
  800: "#733654",
  900: "#613048",
  950: "#3a1628",
};

export default {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        background: "var(--background)",
        foreground: "var(--foreground)",
        plum,
        // Page background behind cards (brand color).
        canvas: "#f4f2f3",
        // Logo colors.
        feather: "#d3b4bd",
        ampersand: "#c6a7b3",
        cup: "#4d4d4d",
        // Secondary colors.
        cream: "#f4ece8",
        blush: "#eadada",
        mist: "#c7dfdf",
        beige: "#c19d85",
        brown: { DEFAULT: "#8e583d", deep: "#482815" },
      },
      fontFamily: {
        // Brand serif. Silver South (the licensed brand font) isn't web-licensed here yet, so
        // this is its Google Fonts stand-in, Playfair Display, loaded in app/layout.tsx.
        display: ["var(--font-display)", "Georgia", "serif"],
      },
    },
  },
  plugins: [typography],
} satisfies Config;
