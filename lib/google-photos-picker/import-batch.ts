import type { PickedMediaItem } from "./client";

/**
 * Pure planning logic for the chunked import loop (see
 * app/api/admin/events/[id]/photos/import/commit/route.ts), split out so it
 * can be unit-tested without mocking the Google Photos API. `existingIds`
 * should include hidden photos too (the commit route's query has no
 * hidden_at filter) -- a hidden photo must still be recognized as "already
 * imported" so re-syncing doesn't resurrect it.
 */
export interface ImportBatchPlan {
  batch: PickedMediaItem[];
  batchSize: number;
  total: number;
  alreadyImported: number;
}

export function planImportBatch(
  allPicked: PickedMediaItem[],
  existingIds: Set<string>,
  batchSize: number
): ImportBatchPlan {
  const notYetImported = allPicked.filter((item) => !existingIds.has(item.id));
  return {
    batch: notYetImported.slice(0, batchSize),
    batchSize,
    total: allPicked.length,
    alreadyImported: existingIds.size,
  };
}

export function extensionForItem(item: PickedMediaItem): string {
  const filename = item.mediaFile.filename || "";
  const dotIndex = filename.lastIndexOf(".");
  if (dotIndex !== -1 && dotIndex < filename.length - 1) {
    return filename.slice(dotIndex + 1).toLowerCase();
  }
  const subtype = item.mediaFile.mimeType?.split("/")[1];
  return subtype ? subtype.toLowerCase() : "bin";
}
