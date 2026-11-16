"use client";

import { useState } from "react";

interface DatePickerProps {
  id: string;
  label: string;
  /** YYYY-MM-DD, or "" for none. */
  value: string;
  onChange: (value: string) => void;
  /** Earliest pickable day, YYYY-MM-DD. */
  min?: string;
  /** Latest pickable day, YYYY-MM-DD. */
  max?: string;
  disabled?: boolean;
  required?: boolean;
  className?: string;
  /**
   * Show the month calendar itself instead of a date input: for a place that is already a dialog or popover, where the
   * day is chosen by clicking it. Needs `today` (YYYY-MM-DD, the reader's today in the zone that matters) to mark the
   * current day; `label` becomes the calendar's accessible name.
   */
  inline?: boolean;
  today?: string;
}

const inputClass =
  "px-3 py-2 border border-slate-300 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-sm disabled:opacity-50";

/**
 * A calendar day picker with its label. Today it's the browser's native date input; new pages use
 * this instead of a bare `<input type="date">` so a fuller calendar picker can replace it in one
 * place. Values are always YYYY-MM-DD strings.
 */
export default function DatePicker({ id, label, value, onChange, min, max, disabled, required, className = "", inline = false, today }: DatePickerProps) {
  if (inline) return <MonthCalendar label={label} value={value} onChange={onChange} min={min} max={max} today={today} className={className} />;
  return (
    <div className={className}>
      <label htmlFor={id} className="block text-sm font-medium mb-1">
        {label}
      </label>
      <input
        id={id}
        type="date"
        value={value}
        min={min}
        max={max}
        disabled={disabled}
        required={required}
        onChange={(e) => onChange(e.target.value)}
        className={inputClass}
      />
    </div>
  );
}

const WEEKDAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const pad = (n: number) => String(n).padStart(2, "0");
const dayString = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;

const navButton =
  "flex h-8 w-8 items-center justify-center rounded-md text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800";

/**
 * A month calendar (Sunday first) with arrows for the previous and next month and year. Days are plain
 * YYYY-MM-DD strings; no time zone is involved, so the caller decides what "today" is.
 */
export function MonthCalendar({
  label,
  value,
  onChange,
  min,
  max,
  today,
  className = "",
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  min?: string;
  max?: string;
  today?: string;
  className?: string;
}) {
  const start = value || today || dayString(new Date().getUTCFullYear(), new Date().getUTCMonth() + 1, 1);
  const [shown, setShown] = useState({ year: Number(start.slice(0, 4)), month: Number(start.slice(5, 7)) });
  const step = (months: number) =>
    setShown(({ year, month }) => {
      const index = year * 12 + (month - 1) + months;
      return { year: Math.floor(index / 12), month: (index % 12) + 1 };
    });

  const leading = new Date(Date.UTC(shown.year, shown.month - 1, 1)).getUTCDay();
  const length = new Date(Date.UTC(shown.year, shown.month, 0)).getUTCDate();
  const cells: (number | null)[] = [...Array<null>(leading).fill(null), ...Array.from({ length }, (_, i) => i + 1)];
  while (cells.length % 7 !== 0) cells.push(null);

  return (
    <div role="group" aria-label={label} className={className}>
      <div className="mb-2 flex items-center justify-between">
        <div className="flex">
          <button type="button" onClick={() => step(-12)} aria-label="Previous year" className={navButton}>
            «
          </button>
          <button type="button" onClick={() => step(-1)} aria-label="Previous month" className={navButton}>
            ‹
          </button>
        </div>
        <div aria-live="polite" className="text-sm font-semibold">
          {MONTH_NAMES[shown.month - 1]} {shown.year}
        </div>
        <div className="flex">
          <button type="button" onClick={() => step(1)} aria-label="Next month" className={navButton}>
            ›
          </button>
          <button type="button" onClick={() => step(12)} aria-label="Next year" className={navButton}>
            »
          </button>
        </div>
      </div>
      <div className="grid grid-cols-7 gap-y-1 text-center text-xs">
        {WEEKDAYS.map((w) => (
          <div key={w} aria-hidden="true" className="py-1 font-semibold text-slate-600 dark:text-slate-400">
            {w}
          </div>
        ))}
        {cells.map((d, i) => {
          if (d === null) return <div key={`blank-${i}`} />;
          const day = dayString(shown.year, shown.month, d);
          const off = (min !== undefined && day < min) || (max !== undefined && day > max);
          const selected = day === value;
          const current = day === today;
          return (
            <button
              key={day}
              type="button"
              disabled={off}
              aria-label={`${MONTH_NAMES[shown.month - 1]} ${d}, ${shown.year}`}
              aria-pressed={selected}
              aria-current={current ? "date" : undefined}
              onClick={() => onChange(day)}
              className={`mx-auto flex h-8 w-8 items-center justify-center rounded-full text-sm disabled:opacity-40 ${
                selected
                  ? "bg-plum-600 font-semibold text-white"
                  : current
                    ? "border border-plum-600 font-semibold text-plum-700 hover:bg-slate-100 dark:text-plum-400 dark:hover:bg-slate-800"
                    : "hover:bg-slate-100 dark:hover:bg-slate-800"
              }`}
            >
              {d}
            </button>
          );
        })}
      </div>
    </div>
  );
}
