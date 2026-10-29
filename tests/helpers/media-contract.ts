import { describe, it, expect, beforeEach } from "vitest";
import type { MediaRepository, NewMediaAsset } from "@/lib/data/media";

export type MediaContractContext = {
  repo: () => MediaRepository;
  /** A string no other run has used (hashes and paths are unique across the table). */
  unique: (label: string) => string;
  /** Two members that exist, to own assets. */
  owners: () => Promise<[string, string]>;
  /** Makes an event that shows this asset as its cover, and returns its id. */
  eventShowing: (assetId: string, title: string, startsAt: string) => Promise<string>;
};

/** Behavior every `MediaRepository` must have; run against the in-memory twin (unit) and Supabase (db). */
export function defineMediaContract(name: string, setup: () => MediaContractContext) {
  describe(`${name} (MediaRepository contract)`, () => {
    let ctx: MediaContractContext;
    beforeEach(() => {
      ctx = setup();
    });

    const asset = (label: string, extra: Partial<NewMediaAsset> = {}): NewMediaAsset => ({
      storage_path: `originals/shared/${ctx.unique(label)}.png`,
      mime_type: "image/png",
      width: 800,
      height: 600,
      bytes: 1234,
      sha256: ctx.unique(label),
      title: `Title ${label}`,
      ...extra,
    });

    it("adds an asset with the defaults a new one gets, tags normalized", async () => {
      const added = await ctx.repo().add(asset("a", { tags: [" Hedgies ", "hedgies", "On-First", ""] }));
      expect(added.id).toMatch(/^media_[1-9A-HJ-NP-Za-km-z]{12}$/);
      expect(added).toMatchObject({ kind: "image", alt_text: null, owner_member_id: null, is_public: false, source: "upload", source_key: null, focal_x: null, focal_y: null, fits: {}, deleted_at: null, tags: ["hedgies", "on-first"] });
      expect(await ctx.repo().byId(added.id)).toEqual(added);
      expect(await ctx.repo().byId("media_AAAAAAAAAAAA")).toBeNull();
    });

    it("refuses a second live copy of the same bytes for the same owner, but not for another owner or after a delete", async () => {
      const [m1, m2] = await ctx.owners();
      const bytes = ctx.unique("dup");
      const first = await ctx.repo().add(asset("d1", { sha256: bytes }));
      await expect(ctx.repo().add(asset("d2", { sha256: bytes }))).rejects.toThrow();
      await ctx.repo().add(asset("d3", { sha256: bytes, owner_member_id: m1 }));
      await ctx.repo().add(asset("d4", { sha256: bytes, owner_member_id: m2 }));
      expect((await ctx.repo().bySha(bytes, null))?.id).toBe(first.id);
      expect((await ctx.repo().bySha(bytes, m1))?.owner_member_id).toBe(m1);

      expect(await ctx.repo().remove(first.id)).toBe(true);
      expect(await ctx.repo().bySha(bytes, null)).toBeNull();
      await ctx.repo().add(asset("d5", { sha256: bytes }));
    });

    it("finds an import by its source", async () => {
      const key = ctx.unique("https://example.test/cover.png");
      const added = await ctx.repo().add(asset("s", { source: "kajabi", source_key: key }));
      expect((await ctx.repo().bySource("kajabi", key))?.id).toBe(added.id);
      expect(await ctx.repo().bySource("video_frame", key)).toBeNull();
      await expect(ctx.repo().add(asset("s2", { source: "kajabi", source_key: key }))).rejects.toThrow();
    });

    it("searches a scope by title or tag, newest first, a page at a time", async () => {
      const [m1] = await ctx.owners();
      const word = ctx.unique("zq").toLowerCase().replace(/[^a-z0-9]/g, "");
      const a = await ctx.repo().add(asset("x1", { title: `Morning ${word} writing`, tags: ["retreat"] }));
      const b = await ctx.repo().add(asset("x2", { title: "Plain", tags: [word] }));
      await ctx.repo().add(asset("x3", { title: `Also ${word}`, owner_member_id: m1 }));
      await ctx.repo().add(asset("x4", { title: "Unrelated" }));

      const byWord = await ctx.repo().search({ scope: "shared", q: word.toUpperCase() });
      expect(byWord.map((r) => r.id).sort()).toEqual([a.id, b.id].sort());
      expect((await ctx.repo().search({ scope: { memberId: m1 }, q: word })).map((r) => r.title)).toEqual([`Also ${word}`]);
      expect((await ctx.repo().search({ scope: "shared", q: word, tag: "retreat" })).map((r) => r.id)).toEqual([a.id]);
      expect(await ctx.repo().search({ scope: "shared", q: `${word}, (x) %` })).toEqual([]); // filter syntax is not passed through
      expect(await ctx.repo().search({ scope: "shared", q: word, limit: 1 })).toHaveLength(1);
      expect(await ctx.repo().search({ scope: "shared", q: word, limit: 1, offset: 1 })).toHaveLength(1);
      expect(await ctx.repo().search({ scope: "shared", q: word, limit: 1, offset: 2 })).toHaveLength(0);
    });

    it("lists the events that show an asset, latest first", async () => {
      const used = await ctx.repo().add(asset("u1"));
      const unused = await ctx.repo().add(asset("u2"));
      expect(await ctx.repo().usages(used.id)).toEqual([]);
      const older = await ctx.eventShowing(used.id, "Older retreat", "2026-03-01");
      const newer = await ctx.eventShowing(used.id, "Newer retreat", "2026-09-01");
      expect(await ctx.repo().usages(used.id)).toEqual([
        { kind: "event", id: newer, title: "Newer retreat" },
        { kind: "event", id: older, title: "Older retreat" },
      ]);
      expect(await ctx.repo().usages(unused.id)).toEqual([]);
    });

    it("edits an asset, and a deleted one can't be edited or found by search", async () => {
      const added = await ctx.repo().add(asset("e"));
      const edited = await ctx.repo().edit(added.id, { title: "New", alt_text: "A hedgehog", tags: ["B", "a"], focal_x: 0.25, focal_y: 0.75, fits: { book_cover_shelf: "white" }, is_public: true });
      expect(edited).toMatchObject({ title: "New", alt_text: "A hedgehog", tags: ["b", "a"], is_public: true, fits: { book_cover_shelf: "white" } });
      expect(Number(edited!.focal_x)).toBe(0.25);
      expect(await ctx.repo().edit("media_AAAAAAAAAAAA", { title: "x" })).toBeNull();

      expect(await ctx.repo().remove(added.id)).toBe(true);
      expect(await ctx.repo().remove(added.id)).toBe(false);
      expect(await ctx.repo().edit(added.id, { title: "again" })).toBeNull();
      expect((await ctx.repo().byId(added.id))?.deleted_at).not.toBeNull();
      expect((await ctx.repo().search({ scope: "shared", q: "New" })).map((r) => r.id)).not.toContain(added.id);
    });
  });
}
