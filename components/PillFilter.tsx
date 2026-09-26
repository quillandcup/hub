"use client";

import type { ReactNode } from "react";

export interface PillOption<T extends string> {
  id: T;
  label: ReactNode;
  /** Optional count badge shown after the label. */
  count?: number;
}

/**
 * Single-select filter / view toggle. Distinct from `Tabs` (underlined, swaps whole panels):
 * use this for narrowing or re-presenting one list in place.
 *
 * - `variant="pill"` (default): separated rounded pills, for filters (e.g. Events page types).
 * - `variant="segmented"`: joined buttons, for small view toggles (e.g. Table / Calendar).
 *
 * Controlled. Each option is a toggle button with `aria-pressed`, grouped under `ariaLabel`.
 */
export function PillFilter<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
  variant = "pill",
  size = "md",
  className = "",
}: {
  options: readonly PillOption<T>[];
  value: T;
  onChange: (id: T) => void;
  ariaLabel: string;
  variant?: "pill" | "segmented";
  size?: "sm" | "md";
  className?: string;
}) {
  const sizeClass = size === "sm" ? "px-2.5 py-1 text-xs" : "px-3 py-1.5 text-sm";

  if (variant === "segmented") {
    return (
      <div
        role="group"
        aria-label={ariaLabel}
        className={`flex rounded-lg border border-slate-300 dark:border-slate-600 overflow-hidden flex-shrink-0 ${className}`}
      >
        {options.map((opt, i) => {
          const active = opt.id === value;
          return (
            <button
              key={opt.id}
              type="button"
              aria-pressed={active}
              onClick={() => onChange(opt.id)}
              className={`${sizeClass} transition-colors ${i > 0 ? "border-l border-slate-300 dark:border-slate-600" : ""} ${
                active
                  ? "bg-blue-600 text-white"
                  : "bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700"
              }`}
            >
              {opt.label}
              {opt.count !== undefined && <CountBadge count={opt.count} active={active} />}
            </button>
          );
        })}
      </div>
    );
  }

  return (
    <div role="group" aria-label={ariaLabel} className={`flex flex-wrap gap-2 ${className}`}>
      {options.map((opt) => {
        const active = opt.id === value;
        return (
          <button
            key={opt.id}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(opt.id)}
            className={`${sizeClass} rounded-full border font-medium whitespace-nowrap transition-colors ${
              active
                ? "bg-blue-600 border-blue-600 text-white dark:bg-blue-500 dark:border-blue-500"
                : "bg-white dark:bg-slate-900 border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800"
            }`}
          >
            {opt.label}
            {opt.count !== undefined && <CountBadge count={opt.count} active={active} />}
          </button>
        );
      })}
    </div>
  );
}

function CountBadge({ count, active }: { count: number; active: boolean }) {
  return (
    <span
      className={`ml-1.5 inline-block min-w-[1.25rem] rounded-full px-1.5 text-xs tabular-nums ${
        active ? "bg-white/20 text-white" : "bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400"
      }`}
    >
      {count}
    </span>
  );
}
