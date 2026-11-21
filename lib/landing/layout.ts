/**
 * Spacing and width for the page builder (docs/product/LANDING_PAGES.md, "Spacing and width"). Pure helpers, safe in the
 * browser and on the server: they turn whatever is stored (missing, half-typed, out of range) into numbers the blocks
 * can use, so a bad value can never reach a style.
 *
 * - A Section has its inner space as four numbers in px (top, bottom, left, right) for each of two sizes: desktop
 *   (`paddingDesktop`) and mobile (`paddingMobile`). "Mobile" is the base style; "desktop" is what a roomy container
 *   switches to (the named `split` size, components/landing/theme.ts).
 * - A block inside a Section sits on a 12-column grid: `span` (1 to 12) is its width on desktop and `spanMobile` its
 *   width on mobile. Both default to the full 12, which is what a block without them does.
 */

export const SPACE_MAX = 320;
export const COLUMNS = 12;

export type Padding = { top: number; bottom: number; left: number; right: number };
export const SIDES = ["top", "bottom", "left", "right"] as const;
export type Side = (typeof SIDES)[number];

export const PADDING_DEFAULT_DESKTOP: Padding = { top: 48, bottom: 48, left: 16, right: 16 };
export const PADDING_DEFAULT_MOBILE: Padding = { top: 32, bottom: 32, left: 16, right: 16 };

/** Quick picks for the space above and below (a preset leaves left and right alone). Values are px: [desktop, mobile]. */
export const PADDING_PRESETS = {
  none: { label: "None", desktop: 0, mobile: 0 },
  small: { label: "Small", desktop: 24, mobile: 16 },
  medium: { label: "Medium", desktop: 48, mobile: 32 },
  large: { label: "Large", desktop: 80, mobile: 48 },
} as const;
export type PaddingPreset = keyof typeof PADDING_PRESETS;

/** A whole number of px from 0 to `SPACE_MAX`; anything else (text, NaN, a missing value) is the fallback. */
export function clampSpace(value: unknown, fallback: number): number {
  const n = typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.min(SPACE_MAX, Math.max(0, Math.round(n)));
}

/** A stored padding as four clamped numbers; a side that is missing or invalid takes the fallback's. */
export function normalizePadding(value: unknown, fallback: Padding): Padding {
  const v = value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  return { top: clampSpace(v.top, fallback.top), bottom: clampSpace(v.bottom, fallback.bottom), left: clampSpace(v.left, fallback.left), right: clampSpace(v.right, fallback.right) };
}

/** The padding for both sizes of a Section's props. */
export function sectionPadding(props: { paddingDesktop?: unknown; paddingMobile?: unknown }): { desktop: Padding; mobile: Padding } {
  return { desktop: normalizePadding(props.paddingDesktop, PADDING_DEFAULT_DESKTOP), mobile: normalizePadding(props.paddingMobile, PADDING_DEFAULT_MOBILE) };
}

/** The preset a padding's top and bottom match for that size, or null when they are custom (or differ). */
export function presetOf(padding: Padding, size: "desktop" | "mobile"): PaddingPreset | null {
  if (padding.top !== padding.bottom) return null;
  const found = (Object.keys(PADDING_PRESETS) as PaddingPreset[]).find((key) => PADDING_PRESETS[key][size] === padding.top);
  return found ?? null;
}

/** A Section's two paddings with a preset's space above and below and the default left and right (starters and the importer build Sections with it). */
export function presetPadding(preset: PaddingPreset): { paddingDesktop: Padding; paddingMobile: Padding } {
  return {
    paddingDesktop: { ...PADDING_DEFAULT_DESKTOP, top: PADDING_PRESETS[preset].desktop, bottom: PADDING_PRESETS[preset].desktop },
    paddingMobile: { ...PADDING_DEFAULT_MOBILE, top: PADDING_PRESETS[preset].mobile, bottom: PADDING_PRESETS[preset].mobile },
  };
}

/** A column count 1 to 12 from a stored value; undefined when it is not one (so "not set" and "garbage" both mean full width). */
export function clampSpan(value: unknown): number | undefined {
  const n = typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : NaN;
  if (!Number.isFinite(n)) return undefined;
  const whole = Math.round(n);
  return whole >= 1 && whole <= COLUMNS ? whole : undefined;
}

/** Widths in columns for both sizes; each is the full 12 unless set. */
export function spanOf(span: unknown, spanMobile: unknown): { desktop: number; mobile: number } {
  return { desktop: clampSpan(span) ?? COLUMNS, mobile: clampSpan(spanMobile) ?? COLUMNS };
}

/** "8 columns" for the width field's label ("1 column" for one). */
export const columnsLabel = (n: number): string => `${n} ${n === 1 ? "column" : "columns"}`;
