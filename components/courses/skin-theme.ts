import type { CSSProperties } from "react";

/**
 * The lesson player skin's public theming properties; plum is the Hub's plum-600 from tailwind.config.ts. One place, so the player and anything drawn
 * beside its controls (ChatVideo's "Open lesson" on the card, outside the skin) resolve the skin's tokens to the same values: the hover colour
 * (`--media-accent`) is the faint default unless these are set.
 */
export const SKIN_TOKENS = {
  "--media-accent-color": "#a64d79",
  "--media-accent-text-color": "#ffffff",
  "--media-border-radius": "1rem",
} as CSSProperties;
