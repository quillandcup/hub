import type { CSSProperties } from "react";
import { spanOf, type Padding } from "@/lib/landing/layout";
import type { PresetName } from "@/lib/media/presets";
import { mediaSrc } from "@/lib/media/url";

/**
 * The page builder's look: the Quill & Cup theme tokens only (config/tailwind.ts), chosen from a short list, never a
 * free colour. Each background carries the text colour that is readable on it, so a block placed on a dark section
 * flips to light text by itself and no combination can fail contrast. Full class strings, so Tailwind finds them.
 */
export const BACKGROUNDS = {
  none: { label: "None (page)", bg: "", text: "text-ink", dark: false, scope: "" },
  white: { label: "White", bg: "bg-white", text: "text-ink", dark: false, scope: "landing-light" },
  cream: { label: "Cream", bg: "bg-cream", text: "text-ink", dark: false, scope: "landing-light" },
  blush: { label: "Blush", bg: "bg-blush", text: "text-ink", dark: false, scope: "landing-light" },
  mist: { label: "Mist", bg: "bg-mist-200", text: "text-ink", dark: false, scope: "landing-light" },
  plum: { label: "Plum", bg: "bg-plum-700", text: "text-white", dark: true, scope: "" },
  brownMid: { label: "Warm brown", bg: "bg-brown", text: "text-white", dark: true, scope: "" },
  brown: { label: "Brown", bg: "bg-brown-deep", text: "text-cream", dark: true, scope: "" },
  charcoal: { label: "Charcoal", bg: "bg-cup", text: "text-white", dark: true, scope: "" },
} as const;
export type BackgroundKey = keyof typeof BACKGROUNDS;
export const BACKGROUND_OPTIONS = (Object.keys(BACKGROUNDS) as BackgroundKey[]).map((value) => ({ label: BACKGROUNDS[value].label, value }));

export function background(key: unknown) {
  return BACKGROUNDS[(typeof key === "string" && key in BACKGROUNDS ? key : "none") as BackgroundKey];
}

export const WIDTHS = {
  narrow: { label: "Narrow column", cls: "max-w-xl" },
  medium: { label: "Medium", cls: "max-w-3xl" },
  wide: { label: "Wide", cls: "max-w-5xl" },
  full: { label: "Full width", cls: "max-w-none" },
} as const;
export type WidthKey = keyof typeof WIDTHS;
export const WIDTH_OPTIONS = (Object.keys(WIDTHS) as WidthKey[]).map((value) => ({ label: WIDTHS[value].label, value }));

export const PADDING = {
  none: { label: "None", cls: "py-0" },
  small: { label: "Small", cls: "py-6" },
  medium: { label: "Medium", cls: "py-12" },
  large: { label: "Large", cls: "py-20" },
} as const;
export type PaddingKey = keyof typeof PADDING;
export const PADDING_OPTIONS = (Object.keys(PADDING) as PaddingKey[]).map((value) => ({ label: PADDING[value].label, value }));

/**
 * "Space above and below" for a block that is a band of its own (Hero, Outcome numbers). Each block's default is the
 * value that reproduces what it drew before the option existed, so a page saved without `padding` is unchanged.
 */
export const BAND_SPACE = {
  hero: {
    none: "py-0",
    small: "py-6 @split:py-8",
    medium: "py-10 @split:py-14",
    large: "py-16 @split:py-24",
  },
  figures: {
    none: "py-0",
    small: "py-6",
    medium: "py-10",
    large: "py-16 @split:py-20",
  },
} as const;

export function pick<T extends Record<string, unknown>>(map: T, key: unknown, fallback: keyof T): T[keyof T] {
  return map[(typeof key === "string" && key in map ? key : fallback) as keyof T];
}

/**
 * A Section's inner space (lib/landing/layout.ts). The numbers are set inline as custom properties (`sectionVars`) and
 * the classes read them: the mobile value is the base and the named `split` container size switches to the desktop one,
 * so it follows the room the page has, in the editor's phone preview as on a phone. Full class strings, so Tailwind finds them.
 */
export const SECTION_SPACE =
  "pt-[var(--sp-t-m)] pb-[var(--sp-b-m)] pl-[var(--sp-l-m)] pr-[var(--sp-r-m)] @split:pt-[var(--sp-t-d)] @split:pb-[var(--sp-b-d)] @split:pl-[var(--sp-l-d)] @split:pr-[var(--sp-r-d)]";

export function sectionVars(desktop: Padding, mobile: Padding): CSSProperties {
  const vars: Record<string, string> = {};
  for (const [size, p] of [["d", desktop], ["m", mobile]] as const) {
    vars[`--sp-t-${size}`] = `${p.top}px`;
    vars[`--sp-b-${size}`] = `${p.bottom}px`;
    vars[`--sp-l-${size}`] = `${p.left}px`;
    vars[`--sp-r-${size}`] = `${p.right}px`;
  }
  return vars as CSSProperties;
}

/** Hiding a Section: the mobile style is the base, `split` switches to desktop. In the editor it is dimmed instead, so it can still be found and selected. */
export function hideClass(hideOnDesktop: boolean, hideOnMobile: boolean, editing: boolean): string {
  if (editing) return hideOnDesktop || hideOnMobile ? "opacity-40" : "";
  if (hideOnDesktop && hideOnMobile) return "hidden";
  if (hideOnMobile) return "hidden @split:block";
  if (hideOnDesktop) return "@split:hidden";
  return "";
}

/** A block's width on the 12-column grid of a Section: `col-span-N` from mobile up, the desktop value from `split`. */
const MOBILE_SPAN = ["", "col-span-1", "col-span-2", "col-span-3", "col-span-4", "col-span-5", "col-span-6", "col-span-7", "col-span-8", "col-span-9", "col-span-10", "col-span-11", "col-span-12"];
const DESKTOP_SPAN = ["", "@split:col-span-1", "@split:col-span-2", "@split:col-span-3", "@split:col-span-4", "@split:col-span-5", "@split:col-span-6", "@split:col-span-7", "@split:col-span-8", "@split:col-span-9", "@split:col-span-10", "@split:col-span-11", "@split:col-span-12"];

export function spanClasses(span: unknown, spanMobile: unknown): string {
  const { desktop, mobile } = spanOf(span, spanMobile);
  return `${MOBILE_SPAN[mobile]} ${DESKTOP_SPAN[desktop]}`;
}

/** A media library image at a preset's size; null when no image is chosen. Public assets are served to anyone (see docs/LANDING_PAGES.md). */
export function pageImage(assetId: unknown, preset: PresetName): string | null {
  return typeof assetId === "string" && assetId ? mediaSrc(assetId, preset) : null;
}
