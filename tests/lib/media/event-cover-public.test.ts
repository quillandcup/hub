import { describe, it, expect, vi } from "vitest";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { InMemoryMediaRepository } from "@/lib/data/media";
import { publishEventCover } from "@/lib/media/event-image";

const image = { storage_path: "originals/shared/a.png", mime_type: "image/png", width: 1600, height: 900, bytes: 1, sha256: "a", title: "Cover" };

describe("publishEventCover", () => {
  it("marks the cover of a publicly announced event public, so a signed-out visitor can be served it", async () => {
    const media = new InMemoryMediaRepository(new InMemoryDataset());
    const asset = await media.add(image);
    expect(asset.is_public).toBe(false);
    expect(await publishEventCover(media, { announced_publicly: true, image_id: asset.id })).toBe(true);
    expect((await media.byId(asset.id))?.is_public).toBe(true);
    // Again is fine, and nothing turns it back.
    expect(await publishEventCover(media, { announced_publicly: true, image_id: asset.id })).toBe(true);
    expect((await media.byId(asset.id))?.is_public).toBe(true);
  });

  it("leaves the cover private for an event that is not announced publicly, and does nothing without a cover or an event", async () => {
    const media = new InMemoryMediaRepository(new InMemoryDataset());
    const asset = await media.add(image);
    expect(await publishEventCover(media, { announced_publicly: false, image_id: asset.id })).toBe(false);
    expect(await publishEventCover(media, { announced_publicly: null, image_id: asset.id })).toBe(false);
    expect((await media.byId(asset.id))?.is_public).toBe(false);
    expect(await publishEventCover(media, { announced_publicly: true, image_id: null })).toBe(false);
    expect(await publishEventCover(media, null)).toBe(false);
  });

  it("does not bring back a deleted asset or invent a missing one", async () => {
    const media = new InMemoryMediaRepository(new InMemoryDataset());
    const asset = await media.add(image);
    await media.remove(asset.id);
    expect(await publishEventCover(media, { announced_publicly: true, image_id: asset.id })).toBe(false);
    expect((await media.byId(asset.id))?.is_public).toBe(false);
    expect(await publishEventCover(media, { announced_publicly: true, image_id: "media_AAAAAAAAAAAA" })).toBe(false);
  });

  it("never fails the save: a read or write error is logged by name and answers false", async () => {
    const media = new InMemoryMediaRepository(new InMemoryDataset());
    media.byId = async () => {
      throw new TypeError("secret detail");
    };
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await publishEventCover(media, { announced_publicly: true, image_id: "media_AAAAAAAAAAAA" })).toBe(false);
    expect(log).toHaveBeenCalledWith("event_cover_publish_failed", "TypeError");
    expect(JSON.stringify(log.mock.calls)).not.toContain("secret detail");
    log.mockRestore();
  });
});
