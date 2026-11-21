import type { MediaAsset, MediaAssetEdit } from "@/lib/data/media";
import { isFitMode, isPresetName } from "./presets";

/**
 * The part of an edit that is about how the picture is framed: a focal point and how each preset fits it. Shared by
 * the staff route and a member's route for their own cover, so both accept the same things. Returns the fields to
 * change, or the message for a 400. `current` is the asset as it is now; a fit for one preset leaves the others.
 */
export function parseLookEdit(body: Record<string, unknown>, current: Pick<MediaAsset, "fits"> | null): { edit: MediaAssetEdit } | { error: string } {
  const edit: MediaAssetEdit = {};
  if (body.focal !== undefined) {
    const f = body.focal as { x?: unknown; y?: unknown } | null;
    if (f === null) Object.assign(edit, { focal_x: null, focal_y: null });
    else if (typeof f?.x === "number" && typeof f?.y === "number" && f.x >= 0 && f.x <= 1 && f.y >= 0 && f.y <= 1) Object.assign(edit, { focal_x: f.x, focal_y: f.y });
    else return { error: "focal must be null or { x, y } between 0 and 1" };
  }
  if (body.fits !== undefined) {
    const fits = body.fits;
    if (typeof fits !== "object" || fits === null || Object.entries(fits).some(([name, fit]) => !isPresetName(name) || !isFitMode(fit))) {
      return { error: "fits must map preset names to crop, extend or white" };
    }
    edit.fits = { ...((current?.fits as Record<string, string> | null) ?? {}), ...fits };
  }
  return { edit };
}
