import { describe, it, expect } from "vitest";
import { eventCoverUrl } from "@/lib/event-cover";

describe("eventCoverUrl", () => {
  it("prefers the library image, then the first imported photo, then nothing", () => {
    const both = { id: "evt_AAAAAAAAAAA1", image_id: "media_AAAAAAAAAAA1", cover_photo_id: "photo_AAAAAAAAAA1" };
    expect(eventCoverUrl(both)).toBe("/api/media/media_AAAAAAAAAAA1/event_card");
    expect(eventCoverUrl(both, "event_hero")).toBe("/api/media/media_AAAAAAAAAAA1/event_hero");
    expect(eventCoverUrl({ ...both, image_id: null })).toBe("/api/events/evt_AAAAAAAAAAA1/photos/photo_AAAAAAAAAA1");
    expect(eventCoverUrl({ id: "evt_AAAAAAAAAAA1", cover_photo_id: null })).toBeNull();
    expect(eventCoverUrl({ id: "evt_AAAAAAAAAAA1" })).toBeNull();
  });
});
