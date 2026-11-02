/** Device preference for animated emoji, GIFs and motion. Stored per device, like the theme. */
export const ANIMATIONS_STORAGE_KEY = "hub-animations";

export type AnimationsChoice = "on" | "off";

/** An explicit choice wins; otherwise follow the device's "reduce motion" setting. */
export function animationsAllowed(stored: string | null, osPrefersReducedMotion: boolean): boolean {
  if (stored === "on") return true;
  if (stored === "off") return false;
  return !osPrefersReducedMotion;
}

/** Images that can move: GIF and WebP (and APNG) by file extension. Query strings are ignored. */
export function looksAnimated(src: string): boolean {
  const path = src.split(/[?#]/)[0].toLowerCase();
  return /\.(gif|webp|apng)$/.test(path);
}
