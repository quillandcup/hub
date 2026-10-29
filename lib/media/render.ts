import { createHash } from "crypto";
import sharp from "sharp";
import { MAX_PIXELS } from "./inspect";
import { chooseFit, presetContentType, presetExtension, PRESETS, type FitMode, type PresetName } from "./presets";

/** Bump when the rendering below changes, so cached renditions made by the old code are not reused. */
const RENDER_VERSION = 1;

/** The parts of an asset a rendition depends on. */
export interface RenderSource {
  id: string;
  width: number;
  height: number;
  focal_x: number | null;
  focal_y: number | null;
  fits: unknown;
}

export interface RenderSettings {
  fit: FitMode;
  /** 0..1 from the top left, or null to let the cropper find the busiest part. */
  focal: { x: number; y: number } | null;
}

export function settingsFor(asset: RenderSource, name: PresetName): RenderSettings {
  const preset = PRESETS[name];
  const chosen = asset.fits && typeof asset.fits === "object" ? (asset.fits as Record<string, unknown>)[name] : undefined;
  return {
    fit: chooseFit(asset, preset, chosen),
    focal: asset.focal_x !== null && asset.focal_y !== null ? { x: Number(asset.focal_x), y: Number(asset.focal_y) } : null,
  };
}

/**
 * Where a rendition is cached in the `media` bucket. The name carries a hash of everything it depends on
 * (preset, fit, focal point, render version), so changing the focal point or the fit makes a new object
 * and no cache needs purging.
 */
export function renditionPath(asset: RenderSource, name: PresetName, settings: RenderSettings = settingsFor(asset, name)): string {
  const hash = createHash("sha1")
    .update(JSON.stringify({ v: RENDER_VERSION, name, preset: PRESETS[name], fit: settings.fit, focal: settings.focal }))
    .digest("hex")
    .slice(0, 12);
  return `renditions/${asset.id}/${name}-${hash}.${presetExtension(PRESETS[name])}`;
}

/** Makes the preset's size from the original: orientation applied, colours in sRGB, metadata (GPS included) dropped. */
export async function renderPreset(original: Buffer, name: PresetName, settings: RenderSettings): Promise<{ body: Buffer; contentType: string }> {
  const preset = PRESETS[name];
  const { width: tw, height: th } = preset;
  const open = (input: Buffer) => sharp(input, { limitInputPixels: MAX_PIXELS }).rotate().toColourspace("srgb");

  let fitted: Buffer;
  if (settings.fit === "crop" && settings.focal) {
    // Scale until the picture covers the frame, then cut a window centred on the focal point (kept inside the picture).
    const meta = await open(original).toBuffer({ resolveWithObject: true });
    const scale = Math.max(tw / meta.info.width, th / meta.info.height);
    const sw = Math.max(tw, Math.round(meta.info.width * scale));
    const sh = Math.max(th, Math.round(meta.info.height * scale));
    const scaled = await sharp(meta.data).resize(sw, sh).toBuffer();
    const left = Math.min(sw - tw, Math.max(0, Math.round(settings.focal.x * sw - tw / 2)));
    const top = Math.min(sh - th, Math.max(0, Math.round(settings.focal.y * sh - th / 2)));
    fitted = await sharp(scaled).extract({ left, top, width: tw, height: th }).toBuffer();
  } else if (settings.fit === "crop") {
    fitted = await open(original).resize(tw, th, { fit: "cover", position: sharp.strategy.attention }).toBuffer();
  } else if (settings.fit === "white") {
    fitted = await open(original).resize(tw, th, { fit: "contain", background: "#ffffff" }).flatten({ background: "#ffffff" }).toBuffer();
  } else {
    // Whole picture, then continue its edge pixels into the empty space.
    const inside = await open(original).resize(tw, th, { fit: "inside" }).toBuffer({ resolveWithObject: true });
    const dx = tw - inside.info.width;
    const dy = th - inside.info.height;
    const left = Math.floor(dx / 2);
    const top = Math.floor(dy / 2);
    fitted = dx || dy ? await sharp(inside.data).extend({ left, right: dx - left, top, bottom: dy - top, extendWith: "copy" }).toBuffer() : inside.data;
  }

  const out = sharp(fitted);
  const body = preset.format === "jpeg"
    ? await out.flatten({ background: "#ffffff" }).jpeg({ quality: preset.quality, mozjpeg: true }).toBuffer()
    : await out.webp({ quality: preset.quality }).toBuffer();
  return { body, contentType: presetContentType(preset) };
}
