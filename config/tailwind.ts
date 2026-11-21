import type { Config } from "tailwindcss";
import typography from "@tailwindcss/typography";
import containerQueries from "@tailwindcss/container-queries";
import plugin from "tailwindcss/plugin";

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
        // Semantic colours for the landing pages (values per mode in app/globals.css): change one there and every page follows.
        page: "rgb(var(--lp-page) / <alpha-value>)",
        card: "rgb(var(--lp-card) / <alpha-value>)",
        tile: "rgb(var(--lp-tile) / <alpha-value>)",
        ink: { DEFAULT: "rgb(var(--lp-ink) / <alpha-value>)", muted: "rgb(var(--lp-ink-muted) / <alpha-value>)" },
        accent: { DEFAULT: "rgb(var(--lp-accent) / <alpha-value>)", ink: "rgb(var(--lp-accent-ink) / <alpha-value>)" },
        warm: "rgb(var(--lp-warm) / <alpha-value>)",
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
        // Announcement gold (landing pages): a fixed brand colour like cream and blush, not themed. `gold-ink` is the dark text readable on it (about 11:1).
        gold: { DEFAULT: "#ffd34d", ink: "#3a2a00" },
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
      // Stacking layers, lowest to highest. Name the layer, never a number: `z-dropdown`, not `z-30`.
      // `tests/lib/z-layers.test.ts` fails on a numeric `z-*`. A component with its own z-indexes inside
      // should be `isolate` so they stay inside it. `docs/Z_LAYERS.md` says what goes where.
      zIndex: {
        raised: "10", // lifts one thing over its siblings inside a component (click area, resize handle)
        float: "20", // floats over content: the "new messages" pill, a panel over the chat
        sticky: "30", // sticky bars that cover the content scrolling under them (day divider, week header)
        dropdown: "40", // popups anchored to a control: menus, tooltips, autocomplete, pickers, a message's hover toolbar
        rail: "45", // the desktop sidebar rail, closed: under the app header
        shell: "50", // the app header, announcement bars, fixed corner widgets
        "rail-open": "55", // the rail open over the page and the header
        overlay: "70", // modals, lightboxes, mobile drawers and their backdrops, banners
        "overlay-top": "80", // above any modal: the search palette, the tour's spotlight
      },
      fontFamily: {
        // Brand serif. Silver South (the licensed brand font) isn't web-licensed here yet, so
        // this is its Google Fonts stand-in, Playfair Display, loaded in app/layout.tsx.
        display: ["var(--font-display)", "Georgia", "serif"],
      },
    },
  },
  plugins: [
    typography,
    containerQueries,
    // Only devices with a mouse or trackpad: keyboard-shortcut hints (`components/Kbd.tsx`) never show on a phone or tablet.
    plugin(({ addVariant }) => addVariant("fine-pointer", "@media (hover: hover) and (pointer: fine)")),
  ],
} satisfies Config;
