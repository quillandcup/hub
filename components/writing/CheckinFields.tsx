"use client";

import {
  FEELING_DISPLAY_GROUPS,
  MAX_FEELINGS,
  NEEDS,
  SESSION_RATINGS,
  toggleFeeling,
  type Feeling,
  type Need,
} from "@/lib/prickle-checkins";

// Check-in inputs shared by the check-in/check-out modal and the Log Progress modal.

export function chipClass(selected: boolean, disabled = false): string {
  const base = "px-3 py-1 rounded-full text-sm border transition-colors";
  if (selected) return `${base} bg-plum-600 border-plum-600 text-white`;
  if (disabled) return `${base} border-slate-200 dark:border-slate-800 text-slate-400 dark:text-slate-600 cursor-not-allowed`;
  return `${base} border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:border-plum-400`;
}

export function FeelingPicker({
  label,
  selected,
  onChange,
  readOnly,
}: {
  label: string;
  selected: Feeling[];
  onChange: (next: Feeling[]) => void;
  readOnly: boolean;
}) {
  const atMax = selected.length >= MAX_FEELINGS;
  return (
    <fieldset>
      <legend className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
        {label} <span className="text-slate-400 font-normal">(up to {MAX_FEELINGS})</span>
      </legend>
      {/* Groups are spaced apart but deliberately unnamed -- see lib/prickle-checkins.ts. */}
      <div className="space-y-2">
        {FEELING_DISPLAY_GROUPS.map((group) => (
          <div key={group[0].key} className="flex flex-wrap gap-2">
            {group.map((f) => {
              const isSelected = selected.includes(f.key);
              return (
                <button
                  key={f.key}
                  type="button"
                  aria-pressed={isSelected}
                  disabled={readOnly || (!isSelected && atMax)}
                  onClick={() => onChange(toggleFeeling(selected, f.key))}
                  className={chipClass(isSelected, !isSelected && atMax)}
                >
                  {f.label}
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </fieldset>
  );
}

/** "How did it go?" as five stars side by side: picking one fills it and every star before it. */
export function RatingPicker({
  label,
  value,
  onChange,
  readOnly = false,
}: {
  label: string;
  value: number | null;
  onChange: (next: number | null) => void;
  readOnly?: boolean;
}) {
  const current = SESSION_RATINGS.find((r) => r.value === value);
  return (
    <fieldset>
      <legend className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">{label}</legend>
      <div className="flex items-center gap-1">
        {SESSION_RATINGS.map((r) => {
          const isSelected = value === r.value;
          const filled = value !== null && r.value <= value;
          return (
            <button
              key={r.value}
              type="button"
              aria-pressed={isSelected}
              aria-label={`${r.value} of ${SESSION_RATINGS.length}: ${r.label}`}
              title={r.label}
              disabled={readOnly}
              onClick={() => onChange(isSelected ? null : r.value)}
              className={`text-2xl leading-none px-0.5 transition-colors disabled:cursor-default ${
                filled ? "text-amber-500" : "text-slate-300 dark:text-slate-600 hover:text-amber-300"
              }`}
            >
              {filled ? "★" : "☆"}
            </button>
          );
        })}
        {current && <span className="ml-2 text-sm text-slate-500 dark:text-slate-400">{current.label}</span>}
      </div>
    </fieldset>
  );
}

export function NeedPicker({
  label,
  value,
  onChange,
  readOnly = false,
}: {
  label: string;
  value: Need | null;
  onChange: (next: Need | null) => void;
  readOnly?: boolean;
}) {
  return (
    <fieldset>
      <legend className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">{label}</legend>
      <div className="flex flex-wrap gap-2">
        {NEEDS.map((n) => {
          const isSelected = value === n.key;
          return (
            <button
              key={n.key}
              type="button"
              aria-pressed={isSelected}
              title={n.hint}
              disabled={readOnly}
              onClick={() => onChange(isSelected ? null : n.key)}
              className={chipClass(isSelected)}
            >
              {n.label}
              <span className={`ml-1 text-xs ${isSelected ? "text-plum-100" : "text-slate-400"}`}>· {n.hint}</span>
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}
