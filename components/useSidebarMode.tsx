"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { usePathname } from "next/navigation";
import { nextNavMode, resolveNavMode, type NavMode } from "@/lib/nav-mode";
import { updateNavMode } from "@/app/(member)/settings/actions";

// In auto-hide the sidebar rests as an icon rail and opens over the page while hovered or focused (the page
// keeps its width, nothing reflows). The member and admin sidebars share this, and the one saved setting.
const AUTO_HIDE_OPEN_DELAY_MS = 150;

const NAV_MODE_LABELS: Record<NavMode, string> = { open: "Sidebar pinned open", auto: "Sidebar auto-hides", closed: "Sidebar pinned closed" };
const NAV_MODE_GLYPHS: Record<NavMode, string> = { open: "«", auto: "»", closed: "→" };

/** Mode state and hover/focus peeking for a desktop sidebar. `saved` is the member's stored mode (null: page default). */
export function useSidebarMode(saved: NavMode | null) {
  const pathname = usePathname();
  const [chosenMode, setChosenMode] = useState<NavMode | null>(saved);
  const [, startSave] = useTransition();
  const [peeking, setPeeking] = useState(false);
  const peekTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const mode = resolveNavMode(chosenMode, pathname ?? "");
  const autoHide = mode === "auto";
  const collapsed = mode === "closed";
  const railOpen = autoHide && peeking;

  const clearPeekTimer = () => {
    if (peekTimer.current) clearTimeout(peekTimer.current);
    peekTimer.current = null;
  };
  useEffect(() => clearPeekTimer, []);
  // Close the peek whenever the route changes.
  useEffect(() => setPeeking(false), [pathname]);

  const stopPeek = () => {
    clearPeekTimer();
    setPeeking(false);
  };

  const cycleMode = () => {
    const next = nextNavMode(mode);
    setChosenMode(next);
    setPeeking(false);
    startSave(async () => {
      const result = await updateNavMode(next);
      if (result.error) setChosenMode(saved);
    });
  };

  /** Props for the element that holds the rail's width. */
  const peekHandlers = autoHide
    ? {
        onMouseEnter: () => {
          clearPeekTimer();
          peekTimer.current = setTimeout(() => setPeeking(true), AUTO_HIDE_OPEN_DELAY_MS);
        },
        onMouseLeave: stopPeek,
        onFocus: () => {
          clearPeekTimer();
          setPeeking(true);
        },
        onBlur: (e: React.FocusEvent<HTMLElement>) => {
          if (!e.currentTarget.contains(e.relatedTarget)) stopPeek();
        },
      }
    : {};

  return { mode, autoHide, collapsed, railOpen, peekHandlers, cycleMode };
}

/** The header button that cycles pinned open, auto-hide, pinned closed. Hidden while an auto-hide rail is at rest. */
export function NavModeButton({ mode, railOpen, onCycle }: { mode: NavMode; railOpen: boolean; onCycle: () => void }) {
  if (mode === "auto" && !railOpen) return null;
  return (
    <button
      onClick={onCycle}
      data-track="nav-mode-toggle"
      className={`p-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors relative z-20 ${mode === "auto" ? "text-plum-600" : ""}`}
      aria-label={`${NAV_MODE_LABELS[mode]}. Switch to ${NAV_MODE_LABELS[nextNavMode(mode)].toLowerCase()}`}
      title={NAV_MODE_LABELS[mode]}
    >
      {NAV_MODE_GLYPHS[mode]}
    </button>
  );
}
