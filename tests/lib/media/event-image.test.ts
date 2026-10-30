import { describe, it, expect } from "vitest";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { InMemoryMediaRepository } from "@/lib/data/media";
import { eventImageError } from "@/lib/media/event-image";

describe("eventImageError", () => {
  it("accepts an event with no image, whether the field is missing or null", async () => {
    const media = new InMemoryMediaRepository(new InMemoryDataset());
    expect(await eventImageError(media, undefined)).toBeNull();
    expect(await eventImageError(media, null)).toBeNull();
  });

  it("accepts a live library asset and refuses anything else, with a reason", async () => {
    const media = new InMemoryMediaRepository(new InMemoryDataset());
    const live = await media.add({ storage_path: "originals/shared/a.png", mime_type: "image/png", width: 1, height: 1, bytes: 1, sha256: "a", title: "A" });
    const gone = await media.add({ storage_path: "originals/shared/b.png", mime_type: "image/png", width: 1, height: 1, bytes: 1, sha256: "b", title: "B" });
    await media.remove(gone.id);

    expect(await eventImageError(media, live.id)).toBeNull();
    expect(await eventImageError(media, gone.id)).toBe("That image isn't in the media library");
    expect(await eventImageError(media, "media_AAAAAAAAAAAA")).toBe("That image isn't in the media library");
    for (const bad of ["nope", 7, {}, "img_AAAAAAAAAAAA"]) expect(await eventImageError(media, bad)).toBe("image_id must be a media library id, or null");
  });
});
