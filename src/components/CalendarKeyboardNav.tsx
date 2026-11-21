"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useRegisterShortcuts } from "@/components/shortcuts/ShortcutsProvider";
import { hasCommandModifier, isOverlayOpen, isTypingTarget } from "@/lib/keyboard";

/** The calendar's shortcuts, for the shortcut panel (`src/lib/shortcuts.ts`): each entry lists the keys that do the same thing. Keep in step with `onKeyDown` below. */
export const CALENDAR_KEYBOARD_SHORTCUTS: ReadonlyArray<{ keys: string[][]; label: string }> = [
  { keys: [["p"], ["k"]], label: "Previous week" },
  { keys: [["n"], ["j"]], label: "Next week" },
  { keys: [["t"]], label: "Jump to today" },
];

interface CalendarKeyboardNavProps {
  prevHref: string;
  nextHref: string | null;
  todayHref: string;
}

/**
 * Google Calendar's week shortcuts: p/k previous, n/j next, t today.
 * It claims the page's single-key shortcuts (`data-page-keys`), so a table's Gmail-style j/k never starts
 * beside it; and a key a focused table already handled (`defaultPrevented`) is not also a week change.
 */
export default function CalendarKeyboardNav({ prevHref, nextHref, todayHref }: CalendarKeyboardNavProps) {
  const router = useRouter();
  useRegisterShortcuts("calendar");

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented || hasCommandModifier(event) || isTypingTarget(event.target) || isOverlayOpen()) return;
      const key = event.key.toLowerCase();
      if (key === "p" || key === "k") router.push(prevHref);
      else if ((key === "n" || key === "j") && nextHref) router.push(nextHref);
      else if (key === "t") router.push(todayHref);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [router, prevHref, nextHref, todayHref]);

  return <span hidden data-page-keys="calendar" />;
}
