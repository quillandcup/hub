import type { ReactNode } from "react";

/** An (i) icon that shows a definition on hover or keyboard focus. */
export function InfoTip({ children, label = "More info" }: { children: ReactNode; label?: string }) {
  return (
    <span className="group relative inline-flex">
      <button
        type="button"
        aria-label={label}
        className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 cursor-help"
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
        className="opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 pointer-events-none absolute left-0 top-6 w-64 p-3 bg-slate-900 dark:bg-slate-700 text-white text-xs font-normal rounded shadow-lg z-10 transition-opacity duration-200"
      >
        {children}
      </span>
    </span>
  );
}
