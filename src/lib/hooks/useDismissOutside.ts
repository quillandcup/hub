"use client";

import { useEffect, type RefObject } from "react";

/**
 * Closes a popup that sits inside `containerRef` when a press lands outside it, or on Escape. Only while `active`. Escape is the one
 * page-wide key it listens for (it just closes the popup; see `.claude/rules/keyboard-shortcuts.md`).
 */
export function useDismissOutside(containerRef: RefObject<HTMLElement | null>, active: boolean, close: () => void) {
  useEffect(() => {
    if (!active) return;
    const outside = (e: PointerEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as globalThis.Node)) close();
    };
    const escape = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [containerRef, active, close]);
}
