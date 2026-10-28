import { describe, it, expect, beforeEach } from "vitest";
import type { EventRepository } from "@/lib/data/events";

export type SeedEvent = { key: string; title: string; startsAt: string };

export type EventContractContext = {
  repo: () => EventRepository;
  /** Replaces the events this context created with these; returns each one's id by its key. */
  seed: (events: SeedEvent[]) => Promise<Record<string, string>>;
};

/** Behavior every `EventRepository` must have; run against the in-memory twin (unit) and Supabase (db). */
export function defineEventContract(name: string, setup: () => EventContractContext) {
  describe(`${name} (EventRepository contract)`, () => {
    let ctx: EventContractContext;
    beforeEach(() => {
      ctx = setup();
    });

    it("lists events for a picker, newest first", async () => {
      const ids = await ctx.seed([
        { key: "old", title: "Spring Retreat", startsAt: "2097-03-01T09:00:00Z" },
        { key: "new", title: "Autumn Retreat", startsAt: "2097-09-01T09:00:00Z" },
        { key: "mid", title: "Summer Workshop", startsAt: "2097-06-01T09:00:00Z" },
      ]);

      const ours = (await ctx.repo().choices()).filter((e) => Object.values(ids).includes(e.id));

      expect(ours.map((e) => [e.title, e.starts_at.slice(0, 10)])).toEqual([
        ["Autumn Retreat", "2097-09-01"],
        ["Summer Workshop", "2097-06-01"],
        ["Spring Retreat", "2097-03-01"],
      ]);
    });

    // --- photos ---
    describe("photos", () => {
      const missingId = "00000000-0000-4000-8000-000000000001";
      const seedTwo = async () => {
        const ids = await ctx.seed([
          { key: "a", title: "Photo Retreat", startsAt: "2097-03-01T09:00:00Z" },
          { key: "b", title: "Other Retreat", startsAt: "2097-04-01T09:00:00Z" },
        ]);
        return { a: ids.a, b: ids.b };
      };

      it("lists the imported media item ids of one event, hidden photos included", async () => {
        const { a, b } = await seedTwo();
        const repo = ctx.repo();
        await repo.addPhoto({ event_id: a, storage_path: `${a}/m1.jpg`, google_media_item_id: "m1" });
        const hidden = await repo.addPhoto({ event_id: a, storage_path: `${a}/m2.jpg`, google_media_item_id: "m2" });
        await repo.addPhoto({ event_id: b, storage_path: `${b}/m3.jpg`, google_media_item_id: "m3" });
        await repo.setPhotoHidden(a, hidden.id, true);

        expect([...(await repo.importedPhotoIds(a))].sort()).toEqual(["m1", "m2"]);
        expect([...(await repo.importedPhotoIds(b))]).toEqual(["m3"]);
      });

      it("stores the photo's details and refuses the same media item twice for one event", async () => {
        const { a, b } = await seedTwo();
        const repo = ctx.repo();
        const photo = await repo.addPhoto({
          event_id: a,
          storage_path: `${a}/p.jpg`,
          google_media_item_id: "m1",
          width: 800,
          height: 600,
          mime_type: "image/jpeg",
          taken_at: "2097-03-01T10:00:00+00:00",
        });

        expect(photo).toMatchObject({ event_id: a, storage_path: `${a}/p.jpg`, google_media_item_id: "m1", width: 800, height: 600, mime_type: "image/jpeg", hidden_at: null });
        await expect(repo.addPhoto({ event_id: a, storage_path: `${a}/again.jpg`, google_media_item_id: "m1" })).rejects.toThrow();
        await expect(repo.addPhoto({ event_id: b, storage_path: `${b}/m1.jpg`, google_media_item_id: "m1" })).resolves.toMatchObject({ event_id: b });
      });

      it("hides and unhides a photo of its own event only", async () => {
        const { a, b } = await seedTwo();
        const repo = ctx.repo();
        const photo = await repo.addPhoto({ event_id: a, storage_path: `${a}/m1.jpg`, google_media_item_id: "m1" });

        expect((await repo.setPhotoHidden(a, photo.id, true))?.hidden_at).toBeTruthy();
        expect((await repo.photoFile(a, photo.id))?.hidden_at).toBeTruthy();
        expect((await repo.setPhotoHidden(a, photo.id, false))?.hidden_at).toBeNull();
        expect(await repo.setPhotoHidden(b, photo.id, true)).toBeNull();
        expect((await repo.photoFile(a, photo.id))?.hidden_at).toBeNull();
      });

      it("gives the image proxy a photo's file and type, and nothing for another event's or a missing one", async () => {
        const { a, b } = await seedTwo();
        const repo = ctx.repo();
        const photo = await repo.addPhoto({ event_id: a, storage_path: `${a}/m1.png`, google_media_item_id: "m1", mime_type: "image/png" });

        expect(await repo.photoFile(a, photo.id)).toEqual({ storage_path: `${a}/m1.png`, mime_type: "image/png", hidden_at: null });
        expect(await repo.photoFile(b, photo.id)).toBeNull();
        expect(await repo.photoFile(a, missingId)).toBeNull();
        expect(await repo.setPhotoHidden(a, missingId, true)).toBeNull();
      });
    });
  });
}
