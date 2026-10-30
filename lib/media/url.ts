import type { PresetName } from "./presets";

/**
 * Where a page loads an asset from, at a preset's size. Safe in client components (no server imports).
 * `version` (an asset's `updated_at`) is ignored by the route; it makes the browser fetch again after the
 * asset's focal point or fit changed, since the URL itself stays the same.
 */
export function mediaSrc(assetId: string, preset: PresetName, version?: string): string {
  return `/api/media/${assetId}/${preset}${version ? `?v=${encodeURIComponent(version)}` : ""}`;
}
