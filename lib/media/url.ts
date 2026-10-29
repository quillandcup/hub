import type { PresetName } from "./presets";

/** Where a page loads an asset from, at a preset's size. Safe in client components (no server imports). */
export function mediaSrc(assetId: string, preset: PresetName): string {
  return `/api/media/${assetId}/${preset}`;
}
