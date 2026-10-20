"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

interface CalendarKeyboardNavProps {
  prevHref: string;
  nextHref: string | null;
  todayHref: string;
}

function isTypingTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}

/** Google Calendar's week shortcuts: p/k previous, n/j next, t today. */
export default function CalendarKeyboardNav({ prevHref, nextHref, todayHref }: CalendarKeyboardNavProps) {
  const router = useRouter();

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.metaKey || event.ctrlKey || event.altKey || isTypingTarget(event.target)) return;
      const key = event.key.toLowerCase();
      if (key === "p" || key === "k") router.push(prevHref);
      else if ((key === "n" || key === "j") && nextHref) router.push(nextHref);
      else if (key === "t") router.push(todayHref);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [router, prevHref, nextHref, todayHref]);

  return null;
}
