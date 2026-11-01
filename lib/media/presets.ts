/**
 * The sizes the Hub shows an image at (docs/MEDIA_LIBRARY.md). A page asks for an asset and a preset
 * name, never a path; the sized copy is made from the original the first time it is asked for.
 *
 * How a picture of a different shape fits a preset is `FitMode`: `crop` fills the frame and cuts the
 * edges (around the focal point when the asset has one), `extend` keeps the whole picture and continues
 * its edge pixels into the empty space, `white` keeps the whole picture on white. A picture within
 * `SAME_SHAPE` of the preset's shape is always cropped, since that cuts almost nothing.
 */

export type FitMode = "crop" | "extend" | "white";
export const FIT_MODES: readonly FitMode[] = ["crop", "extend", "white"];
export const isFitMode = (value: unknown): value is FitMode => FIT_MODES.includes(value as FitMode);

export interface Preset {
  width: number;
  height: number;
  format: "webp" | "jpeg";
  quality: number;
  /** What a picture of another shape gets unless the asset says otherwise: covers hold text, so they keep the whole picture. */
  defaultFit: FitMode;
  /** A source smaller than this is refused rather than blown up (a store would reject it). */
  minSource?: { width: number; height: number };
  /** The file name offered when the rendition is downloaded (`?download=1`), without the extension. */
  downloadName?: string;
}

/** How close (as a ratio of ratios) a picture's shape must be to a preset's to count as the same shape. */
export const SAME_SHAPE = 0.05;

export const PRESETS = {
  thumb: { width: 320, height: 320, format: "webp", quality: 80, defaultFit: "crop" },
  event_card: { width: 800, height: 450, format: "webp", quality: 82, defaultFit: "crop" },
  event_hero: { width: 1600, height: 900, format: "webp", quality: 82, defaultFit: "crop" },
  // The Bookshelf shows covers at 145x215 CSS pixels (lib/bookCover.ts); this is that at 2x.
  book_cover_shelf: { width: 290, height: 430, format: "webp", quality: 85, defaultFit: "extend" },
  // Amazon KDP ebook cover (https://kdp.amazon.com/en_US/help/topic/G6GTK3T3NUHKLEFX): JPEG, ideally
  // 2560 px high by 1600 wide (1.6 : 1), at most 10000 px a side and 50 MB. KDP's pages disagree on the
  // smallest accepted size (500 px on the longest side, or 1000 x 625 on an older page), so the stricter is used.
  // Paperback and hardcover covers are a different job (a full wrap with a spine): not here.
  book_cover_kdp_ebook: {
    width: 1600,
    height: 2560,
    format: "jpeg",
    quality: 92,
    defaultFit: "extend",
    minSource: { width: 625, height: 1000 },
    downloadName: "cover-kindle",
  },
} as const satisfies Record<string, Preset>;

export type PresetName = keyof typeof PRESETS;

export const isPresetName = (value: string): value is PresetName => Object.prototype.hasOwnProperty.call(PRESETS, value);

/** The fit to use for a picture of this size: the same shape is cropped, otherwise the asset's choice or the preset's default. */
export function chooseFit(source: { width: number; height: number }, preset: Preset, chosen?: unknown): FitMode {
  const sameShape = Math.abs(source.width / source.height / (preset.width / preset.height) - 1) <= SAME_SHAPE;
  if (sameShape) return "crop";
  return isFitMode(chosen) ? chosen : preset.defaultFit;
}

/** Why a source is too small for a preset, or null. */
export function tooSmallFor(source: { width: number; height: number }, preset: Preset): string | null {
  const min = "minSource" in preset ? (preset.minSource as Preset["minSource"]) : undefined;
  if (!min) return null;
  if (source.width >= min.width && source.height >= min.height) return null;
  return `This image is ${source.width} x ${source.height} px; at least ${min.width} x ${min.height} px is needed. Upload a larger one.`;
}
