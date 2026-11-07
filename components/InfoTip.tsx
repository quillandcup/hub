import type { ReactNode } from "react";

/** An (i) icon that shows a definition on hover or keyboard focus. */
export function InfoTip({ children, label = "More info" }: { children: ReactNode; label?: string }) {
  return (
    <span className="group relative inline-flex">
      <button
        type="button"
        aria-label={label}
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
        role="tooltip"
        // display:none until shown: an invisible 16rem box hanging off an icon near the right edge
        // widened the page on a phone (the admin member page scrolled sideways into blank space). On a
        // phone it spans the viewport (fixed, left/right set) instead of overflowing it.
        className="hidden group-hover:block group-focus-within:block pointer-events-none z-10 rounded bg-slate-900 p-3 text-xs font-normal text-white shadow-lg dark:bg-slate-700 max-sm:fixed max-sm:inset-x-4 max-sm:mt-7 sm:absolute sm:left-0 sm:top-6 sm:w-64"
      >
        {children}
      </span>
    </span>
  );
}
