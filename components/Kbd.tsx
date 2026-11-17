"use client";

import { useSyncExternalStore } from "react";

/**
 * Keyboard-shortcut hint: one cap per key, for example `<Kbd keys={["mod", "K"]} />` draws "⌘ K" on a Mac and
 * "Ctrl K" elsewhere. Decorative (`aria-hidden`): put `aria-keyshortcuts` on the control that owns the shortcut.
 * Shown only where there is a keyboard, so not on phones and tablets (small screens, or no hover and fine pointer).
 */

/** Key names with a fixed look; anything else is drawn as given (a single letter is upper-cased). */
const NAMED_KEYS: Record<string, string> = {
  enter: "↵",
  esc: "Esc",
  up: "↑",
  down: "↓",
  left: "←",
  right: "→",
  tab: "Tab",
  space: "Space",
};

const APPLE_KEYS: Record<string, string> = { mod: "⌘", shift: "⇧", alt: "⌥" };
const OTHER_KEYS: Record<string, string> = { mod: "Ctrl", shift: "Shift", alt: "Alt" };

const noSubscription = () => () => {};

function detectApple(): boolean {
  if (typeof navigator === "undefined") return false;
  const platform = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform ?? navigator.platform ?? "";
  return /mac|iphone|ipad|ipod/i.test(platform);
}

/** False on the server and during hydration, then the real answer: no markup mismatch. */
function useIsApple(): boolean {
  return useSyncExternalStore(noSubscription, detectApple, () => false);
}

export function keyLabel(key: string, apple: boolean): string {
  const lower = key.toLowerCase();
  const named = (apple ? APPLE_KEYS : OTHER_KEYS)[lower] ?? NAMED_KEYS[lower];
  if (named) return named;
  return key.length === 1 ? key.toUpperCase() : key;
}

/** `onAccent`: the caps sit on a filled accent button (white text and border), not on a plain surface. */
export default function Kbd({ keys, className = "", onAccent = false }: { keys: string[]; className?: string; onAccent?: boolean }) {
  const apple = useIsApple();
  const capColors = onAccent ? "border-white/60 text-white/90" : "border-slate-300 dark:border-slate-600 text-slate-600 dark:text-slate-400";
  return (
    <span aria-hidden="true" data-kbd className={`hidden fine-pointer:sm:inline-flex flex-shrink-0 items-center gap-0.5 ${className}`}>
      {keys.map((key) => (
        <kbd
          key={key}
          className={`rounded border px-1.5 text-xs font-sans ${capColors}`}
        >
          {keyLabel(key, apple)}
        </kbd>
      ))}
    </span>
  );
}
