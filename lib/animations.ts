/** Device preference for animated emoji, GIFs and motion. Stored per device, like the theme. */
export const ANIMATIONS_STORAGE_KEY = "hub-animations";

/** What the member chose: follow the device's "reduce motion" setting (nothing stored), or force it either way. */
export type AnimationsChoice = "system" | "allow" | "reduce";

/** The stored value as a choice; nothing stored, or anything unrecognised, is "system". */
export function animationsChoice(stored: string | null): AnimationsChoice {
  return stored === "allow" || stored === "reduce" ? stored : "system";
}

/** An explicit choice wins; "system" follows the device's "reduce motion" setting. */
export function animationsAllowed(stored: string | null, osPrefersReducedMotion: boolean): boolean {
  const choice = animationsChoice(stored);
  if (choice === "allow") return true;
  if (choice === "reduce") return false;
  return !osPrefersReducedMotion;
}

/** Images that can move: GIF and WebP (and APNG) by file extension. Query strings are ignored. */
export function looksAnimated(src: string): boolean {
  const path = src.split(/[?#]/)[0].toLowerCase();
  return /\.(gif|webp|apng)$/.test(path);
}
