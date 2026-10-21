import type { Config } from "tailwindcss";
import typography from "@tailwindcss/typography";
import containerQueries from "@tailwindcss/container-queries";

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

/**
 * Second accent, built around the brand's mist #c7dfdf (at 200). Used wherever a
 * palette needs a color next to plum that's clearly different from it (roles,
 * badge categories, prickle types, avatar colors) -- in place of Tailwind's
 * purple/indigo/violet, which sit too close to plum. Plain `mist` is the brand color.
 */
const mist = {
  DEFAULT: "#c7dfdf",
  50: "#f3f8f8",
  100: "#e6f0f0",
  200: "#c7dfdf",
  300: "#a3c8c8",
  400: "#74a8a9",
  500: "#548b8c",
  600: "#437273",
  700: "#385d5e",
  800: "#304d4e",
  900: "#2a4142",
  950: "#172627",
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
        mist,
        beige: "#c19d85",
        brown: { DEFAULT: "#8e583d", deep: "#482815" },
      },
      // Container-query sizes (`@container` wrapper, `@split:grid-cols-2` on children; see "Responsive
      // Layout" in CLAUDE.md). Name the layout change, not the width, and use these everywhere so pages
      // reflow at the same widths. `outline` is derived from the app shell: the sidebar appears at `lg`
      // (1024px) and takes 16rem, so no content width reachable below ~1296px of window gets to 62rem,
      // and a side column keyed to it appears once as the window widens (a smaller size would reappear
      // after the sidebar's arrival narrows the content area by 16rem).
      containers: {
        pair: "36rem", // a second column of cards or fields fits beside the first
        cards: "42rem", // two columns of panels
        split: "48rem", // list or side panel beside the main pane
        columns: "56rem", // three or more columns; a side column next to the main content
        outline: "62rem", // video with its outline beside it
      },
      fontFamily: {
        // Brand serif. Silver South (the licensed brand font) isn't web-licensed here yet, so
        // this is its Google Fonts stand-in, Playfair Display, loaded in app/layout.tsx.
        display: ["var(--font-display)", "Georgia", "serif"],
      },
    },
  },
  plugins: [typography, containerQueries],
} satisfies Config;
