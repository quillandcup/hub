import { describe, expect, it } from "vitest";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { createInMemoryRepos } from "@/lib/data/repos";
import { loadComingUp, type ComingUpOptions } from "@/modules/events/page-blocks/live-events";
import { eventSeed, type EventSpec } from "@/tests/helpers/event-fixtures";
import { useFakeClock } from "@/tests/helpers/fake-clock";

/**
 * What a signed-out visitor may be shown of an event's cover (docs/product/LANDING_PAGES.md, "Coming up"): the picture only when its asset is
 * already public, never a private, deleted or missing one, and never a reason to drop the event; plus the date and time a list row needs.
 */
const NOW = Date.parse("2026-11-19T15:00:00Z");
const ALL: ComingUpOptions = { kinds: [], max: 4 };
const spec = (id: string, over: Partial<EventSpec> = {}): EventSpec => ({ id, slug: id, title: id, announced_publicly: true, event_type: "workshop", starts_at: "2026-12-05", ends_at: "2026-12-05", ...over });
const image = { storage_path: "originals/shared/a.png", mime_type: "image/png", width: 1600, height: 900, bytes: 1, title: "Cover" };

describe("the cover of a Coming up event", () => {
  useFakeClock(() => NOW);

  it("is passed on only when the asset is already public, never one that is private, deleted or missing", async () => {
    const dataset = new InMemoryDataset(
      eventSeed([
        spec("evt_pub", { title: "Public Cover", starts_at: "2026-12-01", ends_at: "2026-12-01" }),
        spec("evt_priv", { title: "Private Cover", starts_at: "2026-12-02", ends_at: "2026-12-02" }),
        spec("evt_gone", { title: "Deleted Cover", starts_at: "2026-12-03", ends_at: "2026-12-03" }),
        spec("evt_missing", { title: "Missing Cover", starts_at: "2026-12-04", ends_at: "2026-12-04", image_id: "media_AAAAAAAAAAAA" }),
        spec("evt_none", { title: "No Cover", starts_at: "2026-12-05", ends_at: "2026-12-05" }),
      ]) as never,
    );
    const repos = createInMemoryRepos(dataset);
    const open = await repos.media.add({ ...image, storage_path: "originals/shared/a.png", sha256: "a", is_public: true });
    const closed = await repos.media.add({ ...image, storage_path: "originals/shared/b.png", sha256: "b", is_public: false });
    const gone = await repos.media.add({ ...image, storage_path: "originals/shared/c.png", sha256: "c", is_public: true });
    await repos.media.remove(gone.id);
    const set = (id: string, imageId: string) => {
      (dataset.events.find((e) => e.id === id) as { image_id: string | null }).image_id = imageId;
    };
    set("evt_pub", open.id);
    set("evt_priv", closed.id);
    set("evt_gone", gone.id);

    const out = await loadComingUp(repos, ALL, new Date(NOW));
    expect(Object.fromEntries(out.events.map((e) => [e.title, e.imageAssetId]))).toEqual({
      "Public Cover": open.id,
      "Private Cover": "",
      "Deleted Cover": "",
      "Missing Cover": "",
      "No Cover": "",
    });
  });

  it("never stops the event from being listed when the cover can't be read", async () => {
    const repos = createInMemoryRepos(new InMemoryDataset(eventSeed([spec("evt_a", { title: "Cover Trouble", image_id: "media_AAAAAAAAAAAA" })]) as never));
    repos.media.byId = async () => {
      throw new Error("boom");
    };
    const out = await loadComingUp(repos, ALL, new Date(NOW));
    expect(out.events.map((e) => [e.title, e.imageAssetId])).toEqual([["Cover Trouble", ""]]);
  });
});

describe("a list row's day and time", () => {
  useFakeClock(() => NOW);

  it("gives the first Eastern day and the time of a timed event, the dates of a several-day one, and nothing for an all-day one", async () => {
    const repos = createInMemoryRepos(
      new InMemoryDataset(
        eventSeed([
          spec("evt_t", { title: "Timed", start_time: "2026-12-05T01:00:00Z", end_time: "2026-12-05T02:00:00Z", starts_at: "2026-12-04", ends_at: "2026-12-04" }),
          spec("evt_m", { title: "Several Days", starts_at: "2027-03-13", ends_at: "2027-03-15" }),
          spec("evt_d", { title: "All Day", starts_at: "2027-04-01", ends_at: "2027-04-01" }),
        ]) as never,
      ),
    );
    const out = await loadComingUp(repos, ALL, new Date(NOW));
    const by = Object.fromEntries(out.events.map((e) => [e.title, e]));
    expect(by.Timed).toMatchObject({ date: "2026-12-04", time: "8 – 9 pm EST" });
    expect(by["Several Days"]).toMatchObject({ date: "2027-03-13", time: "Mar 13 to 15, 2027" });
    expect(by["All Day"]).toMatchObject({ date: "2027-04-01", time: "" });
  });
});
