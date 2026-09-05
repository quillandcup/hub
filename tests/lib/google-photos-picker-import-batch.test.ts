import { describe, it, expect } from "vitest";
import { extensionForItem, planImportBatch } from "@/lib/google-photos-picker/import-batch";
import type { PickedMediaItem } from "@/lib/google-photos-picker/client";

function item(id: string, filename = "photo.jpg", mimeType = "image/jpeg"): PickedMediaItem {
  return {
    id,
    type: "PHOTO",
    mediaFile: { baseUrl: `https://example.com/${id}`, mimeType, filename },
  };
}

describe("planImportBatch", () => {
  it("skips items already imported (dedup by google_media_item_id)", () => {
    const picked = [item("a"), item("b"), item("c")];
    const existing = new Set(["b"]);
    const plan = planImportBatch(picked, existing, 10);
    expect(plan.batch.map((i) => i.id)).toEqual(["a", "c"]);
    expect(plan.total).toBe(3);
    expect(plan.alreadyImported).toBe(1);
  });

  it("treats hidden photos as already imported -- re-sync must not resurrect them", () => {
    // The commit route's existingIds query has no hidden_at filter, so a
    // hidden photo's id is still in `existing` here -- this is what keeps
    // it out of the batch on the next sync.
    const picked = [item("hidden-photo"), item("new-photo")];
    const existing = new Set(["hidden-photo"]);
    const plan = planImportBatch(picked, existing, 10);
    expect(plan.batch.map((i) => i.id)).toEqual(["new-photo"]);
  });

  it("caps the batch at batchSize, leaving the rest for the next call", () => {
    const picked = [item("a"), item("b"), item("c")];
    const plan = planImportBatch(picked, new Set(), 2);
    expect(plan.batch.map((i) => i.id)).toEqual(["a", "b"]);
    expect(plan.total).toBe(3);
  });

  it("returns an empty batch when everything is already imported (idempotent re-run)", () => {
    const picked = [item("a"), item("b")];
    const existing = new Set(["a", "b"]);
    const plan = planImportBatch(picked, existing, 10);
    expect(plan.batch).toEqual([]);
    expect(plan.alreadyImported).toBe(2);
  });
});

describe("extensionForItem", () => {
  it("uses the filename's extension when present", () => {
    expect(extensionForItem(item("a", "IMG_1234.HEIC"))).toBe("heic");
  });

  it("falls back to the mime subtype when the filename has no extension", () => {
    expect(extensionForItem(item("a", "IMG_1234", "image/png"))).toBe("png");
  });
});
