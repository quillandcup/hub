"use client";

import type { KeyboardEvent } from "react";
import {
  clampSpace,
  clampSpan,
  columnsLabel,
  COLUMNS,
  normalizePadding,
  PADDING_DEFAULT_DESKTOP,
  PADDING_DEFAULT_MOBILE,
  PADDING_PRESETS,
  presetOf,
  SIDES,
  SPACE_MAX,
  type Padding,
  type PaddingPreset,
  type Side,
} from "@/lib/landing/layout";

/** Custom Puck fields for spacing and width (docs/LANDING_PAGES.md, "Spacing and width"). Editor only: the public page never loads this file. */

const LABEL = "mb-1.5 text-sm font-medium text-slate-700 dark:text-slate-200";

/**
 * A block's width on its Section's 12-column grid: a row of twelve squares, the Nth sets "N columns". Unset means the
 * full width (what a block without it does), and Reset goes back to that. One tab stop; the arrow keys move the choice
 * (a radio group), Home and End jump to 1 and 12.
 */
export function SpanField({ value, onChange, label }: { value: unknown; onChange: (next: number | undefined) => void; label: string }) {
  const current = clampSpan(value);
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const from = current ?? COLUMNS;
    const next = e.key === "ArrowRight" || e.key === "ArrowUp" ? Math.min(COLUMNS, from + 1) : e.key === "ArrowLeft" || e.key === "ArrowDown" ? Math.max(1, from - 1) : e.key === "Home" ? 1 : e.key === "End" ? COLUMNS : null;
    if (next === null) return;
    e.preventDefault();
    onChange(next);
    // Focus follows the choice, so the next key press carries on from it.
    e.currentTarget.querySelectorAll<HTMLElement>("[role=radio]")[next - 1]?.focus();
  };
  return (
    <div>
      {/* Puck draws no label for a custom field, so it is shown here. */}
      <p className={LABEL}>{label}</p>
      <div role="radiogroup" aria-label={label} onKeyDown={onKeyDown} className="flex gap-1">
        {Array.from({ length: COLUMNS }, (_, i) => i + 1).map((n) => (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={current === n}
            aria-label={columnsLabel(n)}
            tabIndex={n === (current ?? COLUMNS) ? 0 : -1}
            onClick={() => onChange(n)}
            className={`h-6 flex-1 rounded-sm border focus:outline-none focus-visible:ring-2 focus-visible:ring-plum-600 ${current !== undefined && n <= current ? "border-plum-600 bg-plum-600" : "border-slate-300 bg-white hover:bg-plum-50 dark:border-slate-600 dark:bg-slate-800"}`}
          />
        ))}
      </div>
      <div className="mt-1 flex items-center justify-between text-xs text-slate-600 dark:text-slate-300">
        <span aria-live="polite">{current === undefined ? "Full width" : columnsLabel(current)}</span>
        {current !== undefined && (
          <button type="button" onClick={() => onChange(undefined)} className="rounded px-1 underline underline-offset-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-plum-600">
            Reset
          </button>
        )}
      </div>
    </div>
  );
}

const SIDE_LABEL: Record<Side, string> = { top: "Top", bottom: "Bottom", left: "Left", right: "Right" };

/** A Section's inner space for one size: four numbers (px), and quick picks for the space above and below. */
export function PaddingField({ value, onChange, size, label }: { value: unknown; onChange: (next: Padding) => void; size: "desktop" | "mobile"; label: string }) {
  const padding = normalizePadding(value, size === "desktop" ? PADDING_DEFAULT_DESKTOP : PADDING_DEFAULT_MOBILE);
  const active = presetOf(padding, size);
  return (
    <div>
      <p className={LABEL}>{label}</p>
      <div role="group" aria-label={`${label}: quick picks for top and bottom`} className="mb-2 flex gap-1">
        {(Object.keys(PADDING_PRESETS) as PaddingPreset[]).map((key) => (
          <button
            key={key}
            type="button"
            aria-pressed={active === key}
            onClick={() => onChange({ ...padding, top: PADDING_PRESETS[key][size], bottom: PADDING_PRESETS[key][size] })}
            className="flex-1 rounded border border-slate-300 px-2 py-1 text-xs hover:bg-slate-100 aria-pressed:border-plum-600 aria-pressed:bg-plum-50 aria-pressed:text-plum-700 dark:border-slate-600 dark:hover:bg-slate-800"
          >
            {PADDING_PRESETS[key].label}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-2">
        {SIDES.map((side) => (
          <label key={side} className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
            <span className="w-11 shrink-0">{SIDE_LABEL[side]}</span>
            <input
              type="number"
              inputMode="numeric"
              min={0}
              max={SPACE_MAX}
              aria-label={`${label}, ${SIDE_LABEL[side].toLowerCase()} (px)`}
              value={padding[side]}
              onChange={(e) => onChange({ ...padding, [side]: clampSpace(e.target.value, 0) })}
              className="w-full rounded border border-slate-300 px-2 py-1 text-sm text-slate-900 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
            />
          </label>
        ))}
      </div>
      <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">In px, 0 to {SPACE_MAX}.</p>
    </div>
  );
}
