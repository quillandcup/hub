import { useId, type ReactNode } from "react";

/**
 * An (i) icon that shows a definition on hover or keyboard focus. THE tooltip of the app: don't
 * hand-roll a hover box (`tests/lib/tooltips.test.ts` fails on one).
 *
 * - Hidden with display:none, never opacity-0/invisible: those still lay the box out, and a 16rem box
 *   hanging off an icon near the right edge widened the page on a phone (the admin member page scrolled
 *   sideways into blank space).
 * - On a phone it spans the viewport (fixed, left/right set) instead of overflowing it.
 * - Keyboard: the button takes focus and the tip shows while it (or anything in the tip) has focus.
 * - `interactive` lets the tip hold a link: it takes pointer events while shown, and a bridge keeps
 *   it open while the pointer travels from the icon to it.
 */
export function InfoTip({
  children,
  label = "More info",
  interactive = false,
}: {
  children: ReactNode;
  label?: string;
  interactive?: boolean;
}) {
  const tipId = useId();
  return (
    <span className="group relative inline-flex">
      <button
        type="button"
        aria-label={label}
        aria-describedby={tipId}
        className="text-slate-500 dark:text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 cursor-help"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
          />
        </svg>
      </button>
      <span
        id={tipId}
        role="tooltip"
        className={`hidden group-hover:block group-focus-within:block z-10 rounded bg-slate-900 p-3 text-xs font-normal text-white shadow-lg dark:bg-slate-700 max-sm:fixed max-sm:inset-x-4 max-sm:mt-7 sm:absolute sm:left-0 sm:top-6 sm:w-64 ${
          interactive
            ? "pointer-events-auto before:absolute before:bottom-full before:left-0 before:h-2 before:w-full before:content-['']"
            : "pointer-events-none"
        }`}
      >
        {children}
      </span>
    </span>
  );
}
