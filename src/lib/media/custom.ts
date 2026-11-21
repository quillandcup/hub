import { isFitMode, type FitMode } from "./presets";
import type { RenderSpec } from "./render";

/** The largest side, and the most pixels, a download may ask for. */
export const MAX_CUSTOM_SIDE = 8000;
export const MAX_CUSTOM_PIXELS = 40_000_000;

const FORMATS = ["jpeg", "webp", "png"] as const;

export type CustomSize = { ok: true; spec: RenderSpec; fit: FitMode } | { ok: false; error: string };

/**
 * A download at any size: `?width=1600&height=2560` (both required, whole pixels), optionally
 * `&format=jpeg|webp|png` (jpeg when not given) and `&fit=crop|extend|white` (crop when not given).
 */
export function parseCustomSize(params: URLSearchParams): CustomSize {
  const side = (name: string) => {
    const raw = params.get(name);
    return raw !== null && /^\d{1,5}$/.test(raw) ? Number(raw) : NaN;
  };
  const width = side("width");
  const height = side("height");
  if (!(width >= 1 && height >= 1)) return { ok: false, error: "width and height are required, in whole pixels" };
  if (width > MAX_CUSTOM_SIDE || height > MAX_CUSTOM_SIDE || width * height > MAX_CUSTOM_PIXELS) {
    return { ok: false, error: `That size is too large: at most ${MAX_CUSTOM_SIDE} px a side and ${MAX_CUSTOM_PIXELS / 1_000_000} megapixels` };
  }
  const format = params.get("format") ?? "jpeg";
  if (!(FORMATS as readonly string[]).includes(format)) return { ok: false, error: "format must be jpeg, webp or png" };
  const fit = params.get("fit") ?? "crop";
  if (!isFitMode(fit)) return { ok: false, error: "fit must be crop, extend or white" };
  return { ok: true, spec: { width, height, format: format as RenderSpec["format"], quality: 92 }, fit };
}
