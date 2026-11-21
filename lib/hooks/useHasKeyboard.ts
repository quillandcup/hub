import { useSyncExternalStore } from "react";

/**
 * A mouse or trackpad and a screen at least Tailwind's `sm` (640px) wide: the same test as the `fine-pointer:sm:`
 * variant that shows `Kbd` key caps (`config/tailwind.ts`), so wherever caps are hidden the shortcut panel is too.
 */
export const KEYBOARD_MEDIA_QUERY = "(hover: hover) and (pointer: fine) and (min-width: 640px)";

function subscribe(onChange: () => void): () => void {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return () => {};
  const query = window.matchMedia(KEYBOARD_MEDIA_QUERY);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

function read(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(KEYBOARD_MEDIA_QUERY).matches;
}

/** False on the server and during hydration, then the device's answer (no markup mismatch). */
export function useHasKeyboard(): boolean {
  return useSyncExternalStore(subscribe, read, () => false);
}
