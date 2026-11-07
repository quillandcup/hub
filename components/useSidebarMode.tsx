"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { usePathname } from "next/navigation";
import { NAV_MODES, resolveNavMode, type NavMode } from "@/lib/nav-mode";
import { updateNavMode } from "@/app/(member)/settings/actions";

// In auto-hide the sidebar rests as an icon rail and opens over the page while hovered or focused (the page
// keeps its width, nothing reflows). The member and admin sidebars share this, and the one saved setting.
const AUTO_HIDE_OPEN_DELAY_MS = 150;

const NAV_MODE_LABELS: Record<NavMode, string> = { open: "Always open", closed: "Collapsed", auto: "Auto-show on hover" };
const NAV_MODE_HINTS: Record<NavMode, string> = {
  open: "Pinned beside the page",
  closed: "Icons only",
  auto: "Opens over the page when you point at it",
};

/** Chrome vertical-tabs icons: three lines (the tab list) with a chevron. Open points left (collapse), collapsed
 *  points right (expand), auto-show carries a dot for "appears when pointed at". */
function NavModeIcon({ mode }: { mode: NavMode }) {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {mode === "closed" ? (
        <>
          <path d="M3 5l3 3-3 3" />
          <path d="M9 5h8M9 10h8M3 15h14" />
        </>
      ) : (
        <>
          <path d="M3 5h9M3 10h9M3 15h14" />
          <path d={mode === "open" ? "M17 5l-3 3 3 3" : "M16 6.5h.01"} />
        </>
      )}
    </svg>
  );
}

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

  const setMode = (next: NavMode) => {
    if (next === mode) return;
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

  return { mode, autoHide, collapsed, railOpen, peekHandlers, setMode };
}

/** The header button that opens a small menu of the three modes. Hidden while an auto-show rail is at rest. */
export function NavModeButton({ mode, railOpen, onChange }: { mode: NavMode; railOpen: boolean; onChange: (mode: NavMode) => void }) {
  const [menuOpen, setMenuOpen] = useState(false);
  if (mode === "auto" && !railOpen) return null;
  return (
    <div
      className="relative z-20"
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) setMenuOpen(false);
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") setMenuOpen(false);
      }}
    >
      <button
        type="button"
        onClick={() => setMenuOpen((open) => !open)}
        data-track="nav-mode-toggle"
        className={`p-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors ${mode === "auto" ? "text-plum-600" : ""}`}
        aria-label={`Sidebar: ${NAV_MODE_LABELS[mode].toLowerCase()}. Change mode`}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        title={`Sidebar: ${NAV_MODE_LABELS[mode]}`}
      >
        <NavModeIcon mode={mode} />
      </button>
      {menuOpen && (
        <div role="menu" aria-label="Sidebar mode" className="absolute left-0 top-full mt-1 w-56 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-xl p-1">
          {NAV_MODES.map((m) => (
            <button
              key={m}
              type="button"
              role="menuitemradio"
              aria-checked={m === mode}
              title={NAV_MODE_HINTS[m]}
              onClick={() => {
                setMenuOpen(false);
                onChange(m);
              }}
              className={`flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm hover:bg-slate-100 dark:hover:bg-slate-800 ${m === mode ? "text-plum-600 dark:text-plum-400 font-medium" : "text-slate-700 dark:text-slate-300"}`}
            >
              <NavModeIcon mode={m} />
              <span className="whitespace-nowrap">{NAV_MODE_LABELS[m]}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
