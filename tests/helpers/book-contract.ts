import { describe, it, expect, beforeEach } from "vitest";
import { BookExistsError, type BookRepository, type NewBook } from "@/lib/data/books";

export type BookContractMember = { id: string; name: string; displayName: string | null };

export type BookContractContext = {
  repo: () => BookRepository;
  /** A string no other run has used (titles are searched across the whole table). */
  unique: (label: string) => string;
  /** Two members that exist, to own books. */
  members: () => Promise<[BookContractMember, BookContractMember]>;
  /** A library image (with its size) a book can have as its cover. */
  coverAsset: (width: number, height: number) => Promise<string>;
  /** A writing project of this member, for a book to be published from. */
  project: (memberId: string) => Promise<string>;
};

/** Behavior every `BookRepository` must have; run against the in-memory twin (unit) and Supabase (db). */
export function defineBookContract(name: string, setup: () => BookContractContext) {
  describe(`${name} (BookRepository contract)`, () => {
    let ctx: BookContractContext;
    beforeEach(() => {
      ctx = setup();
    });

    const book = (memberId: string, title: string, extra: Partial<NewBook> = {}): NewBook => ({
      member_id: memberId,
      title,
      cover_url: "https://example.com/cover.png",
      purchase_url: "https://example.com/buy",
      published_date: "2026-03-05",
      ...extra,
    });

    it("adds a book with the defaults a new one gets, and shows it on the shelf, the profile and My Books", async () => {
      const [m1] = await ctx.members();
      const title = ctx.unique("Defaults");
      const id = await ctx.repo().add(book(m1.id, title, { description: "A tale." }));
      expect(id).toMatch(/^book_[1-9A-HJ-NP-Za-km-z]{12}$/);

      expect(await ctx.repo().ofMember(m1.id)).toEqual([{ id, title, cover_url: "https://example.com/cover.png", purchase_url: "https://example.com/buy", published_date: "2026-03-05" }]);
      expect(await ctx.repo().mine(m1.id)).toEqual([
        { id, title, description: "A tale.", cover_url: "https://example.com/cover.png", purchase_url: "https://example.com/buy", published_date: "2026-03-05", price: null, genres: [], format: "print", project_id: null, pen_name: null, cover_asset: null },
      ]);
      const onShelf = (await ctx.repo().shelf()).find((b) => b.id === id);
      expect(onShelf).toEqual({
        id,
        member_id: m1.id,
        title,
        description: "A tale.",
        cover_url: "https://example.com/cover.png",
        purchase_url: "https://example.com/buy",
        published_date: "2026-03-05",
        price: null,
        genres: [],
        format: "print",
        pen_name: null,
        author: { name: m1.name, display_name: m1.displayName },
      });
    });

    it("keeps the pen name, price, genres and format, and the library image behind the cover with its size", async () => {
      const [m1] = await ctx.members();
      const asset = await ctx.coverAsset(1600, 2560);
      const id = await ctx.repo().add(book(m1.id, ctx.unique("Full"), { pen_name: "A. E. Byron", price: 17.99, genres: ["Fantasy", "Cozy Mystery"], format: "ebook", cover_asset_id: asset }));
      const mine = (await ctx.repo().mine(m1.id)).find((b) => b.id === id);
      expect(mine).toMatchObject({ pen_name: "A. E. Byron", price: 17.99, genres: ["Fantasy", "Cozy Mystery"], format: "ebook", cover_asset: { id: asset, width: 1600, height: 2560 } });
    });

    it("lists a member's books newest published first, the id breaking ties, and not another member's", async () => {
      const [m1, m2] = await ctx.members();
      const a = await ctx.repo().add(book(m1.id, ctx.unique("Old"), { published_date: "2025-01-01" }));
      const b = await ctx.repo().add(book(m1.id, ctx.unique("New"), { published_date: "2026-06-01" }));
      const c = await ctx.repo().add(book(m1.id, ctx.unique("Same day"), { published_date: "2026-06-01" }));
      await ctx.repo().add(book(m2.id, ctx.unique("Theirs"), { published_date: "2026-07-01" }));
      // Books of one day come in the same order every time (by id), whatever the database's collation makes of it.
      const inOrder = (list: { id: string }[]) => {
        const ids = list.map((x) => x.id).filter((id) => [a, b, c].includes(id));
        expect(new Set(ids.slice(0, 2))).toEqual(new Set([b, c]));
        expect(ids[2]).toBe(a);
        return ids;
      };
      const first = inOrder(await ctx.repo().ofMember(m1.id));
      expect(inOrder(await ctx.repo().mine(m1.id))).toEqual(first);
      expect(inOrder(await ctx.repo().shelf())).toEqual(first);
      expect(first).toHaveLength(3);
      expect((await ctx.repo().ofMember(m1.id)).some((x) => x.published_date === "2026-07-01")).toBe(false);
    });

    it("refuses a second live book for one project, but allows it once the first is deleted", async () => {
      const [m1] = await ctx.members();
      const project = await ctx.project(m1.id);
      const first = await ctx.repo().add(book(m1.id, ctx.unique("P1"), { project_id: project }));
      await expect(ctx.repo().add(book(m1.id, ctx.unique("P2"), { project_id: project }))).rejects.toBeInstanceOf(BookExistsError);
      expect(await ctx.repo().remove(first)).toBe(true);
      const second = await ctx.repo().add(book(m1.id, ctx.unique("P3"), { project_id: project }));
      expect((await ctx.repo().mine(m1.id)).find((b) => b.id === second)?.project_id).toBe(project);
    });

    it("throws on a book the database refuses", async () => {
      const [m1] = await ctx.members();
      await expect(ctx.repo().add(book(m1.id, ctx.unique("Bad format"), { format: "audio" }))).rejects.toThrow();
      await expect(ctx.repo().add(book("mbr_ZZZZZZZZZZZZ", ctx.unique("No member")))).rejects.toThrow();
    });

    it("changes a live book and says whether there was one", async () => {
      const [m1] = await ctx.members();
      const id = await ctx.repo().add(book(m1.id, ctx.unique("Before")));
      const asset = await ctx.coverAsset(800, 1200);
      expect(await ctx.repo().update(id, { title: "After", price: 9.5, cover_asset_id: asset, cover_url: "/api/media/x/book_cover_shelf" })).toBe(true);
      expect((await ctx.repo().mine(m1.id)).find((b) => b.id === id)).toMatchObject({ title: "After", price: 9.5, cover_url: "/api/media/x/book_cover_shelf", cover_asset: { id: asset } });
      expect(await ctx.repo().update("book_ZZZZZZZZZZZZ", { title: "Nope" })).toBe(false);
    });

    it("soft deletes: the book leaves every list and count but its cover can still be read, and it can't be changed or deleted again", async () => {
      const [m1] = await ctx.members();
      const asset = await ctx.coverAsset(800, 1200);
      const keep = await ctx.repo().add(book(m1.id, ctx.unique("Keep")));
      const id = await ctx.repo().add(book(m1.id, ctx.unique("Gone"), { cover_asset_id: asset }));
      expect(await ctx.repo().countLive(m1.id)).toBe(2);

      expect(await ctx.repo().remove(id)).toBe(true);
      expect(await ctx.repo().remove(id)).toBe(false);
      expect(await ctx.repo().update(id, { title: "Back" })).toBe(false);
      expect(await ctx.repo().remove("book_ZZZZZZZZZZZZ")).toBe(false);

      expect((await ctx.repo().ofMember(m1.id)).map((b) => b.id)).toEqual([keep]);
      expect((await ctx.repo().mine(m1.id)).map((b) => b.id)).toEqual([keep]);
      expect((await ctx.repo().shelf()).some((b) => b.id === id)).toBe(false);
      expect(await ctx.repo().countLive(m1.id)).toBe(1);
      expect(await ctx.repo().coverAssetIdOf(id)).toBe(asset);
    });

    it("tells the library image a cover is now: null for an older cover or no such book", async () => {
      const [m1] = await ctx.members();
      const asset = await ctx.coverAsset(800, 1200);
      const withAsset = await ctx.repo().add(book(m1.id, ctx.unique("Asset"), { cover_asset_id: asset }));
      const without = await ctx.repo().add(book(m1.id, ctx.unique("Link")));
      expect(await ctx.repo().coverAssetIdOf(withAsset)).toBe(asset);
      expect(await ctx.repo().coverAssetIdOf(without)).toBeNull();
      expect(await ctx.repo().coverAssetIdOf("book_ZZZZZZZZZZZZ")).toBeNull();
    });

    it("counts live books per member", async () => {
      const [m1, m2] = await ctx.members();
      expect(await ctx.repo().countLive(m1.id)).toBe(0);
      const gone = await ctx.repo().add(book(m1.id, ctx.unique("c1")));
      await ctx.repo().add(book(m1.id, ctx.unique("c2")));
      await ctx.repo().add(book(m1.id, ctx.unique("c3")));
      await ctx.repo().remove(gone);
      expect(await ctx.repo().countLive(m1.id)).toBe(2);
      expect(await ctx.repo().countLive(m2.id)).toBe(0);
      const counts = await ctx.repo().liveCountsByMember();
      expect(counts.get(m1.id)).toBe(2);
      expect(counts.has(m2.id)).toBe(false);
    });

    it("searches live books for every word in the title or description, any case, newest first", async () => {
      const [m1, m2] = await ctx.members();
      const tag = ctx.unique("zq").toLowerCase().replace(/[^a-z0-9]/g, "");
      const byTitle = await ctx.repo().add(book(m1.id, `The ${tag.toUpperCase()} Garden`, { published_date: "2026-01-01" }));
      const byDescription = await ctx.repo().add(book(m2.id, ctx.unique("Other"), { description: `A tale of a ${tag} dragon`, published_date: "2026-02-01" }));
      const both = await ctx.repo().add(book(m1.id, `${tag} dragon`, { published_date: "2026-03-01", pen_name: "Pen" }));
      const deleted = await ctx.repo().add(book(m1.id, `${tag} deleted`, { published_date: "2026-04-01" }));
      await ctx.repo().remove(deleted);
      const search = (extra: Partial<Parameters<BookRepository["search"]>[0]> = {}) => ctx.repo().search({ words: [tag], authorIds: null, limit: 10, offset: 0, ...extra });

      expect((await search()).map((b) => b.id)).toEqual([both, byDescription, byTitle]);
      expect((await search({ words: [tag, "DRAGON"] })).map((b) => b.id)).toEqual([both, byDescription]);
      expect((await search({ words: [tag, "garden", "dragon"] })).map((b) => b.id)).toEqual([]);
      expect((await search()).find((b) => b.id === both)).toEqual({
        id: both,
        title: `${tag} dragon`,
        description: null,
        cover_url: "https://example.com/cover.png",
        published_date: "2026-03-01",
        pen_name: "Pen",
        author: { id: m1.id, name: m1.name },
      });
    });

    it("finds a book by one of its genres, any case, along with its title and description words", async () => {
      const [m1] = await ctx.members();
      const tag = ctx.unique("zg").toLowerCase().replace(/[^a-z0-9]/g, "");
      const tagged = await ctx.repo().add(book(m1.id, ctx.unique("Genre book"), { genres: ["Cozy Mystery", tag.toUpperCase()], published_date: "2026-01-01" }));
      const plain = await ctx.repo().add(book(m1.id, `${tag} plain`, { published_date: "2026-02-01" }));
      const search = (words: string[]) => ctx.repo().search({ words, authorIds: null, limit: 10, offset: 0 });

      expect((await search([tag])).map((b) => b.id)).toEqual([plain, tagged]);
      expect((await search([tag, "cozy"])).map((b) => b.id)).toEqual([tagged]);
      expect((await search(["cozy mystery", tag])).map((b) => b.id)).toEqual([tagged]);
    });

    it("narrows a search by author and by publish date, and pages through it", async () => {
      const [m1, m2] = await ctx.members();
      const tag = ctx.unique("yq").toLowerCase().replace(/[^a-z0-9]/g, "");
      const a = await ctx.repo().add(book(m1.id, `${tag} a`, { published_date: "2026-01-10" }));
      const b = await ctx.repo().add(book(m2.id, `${tag} b`, { published_date: "2026-02-10" }));
      const c = await ctx.repo().add(book(m1.id, `${tag} c`, { published_date: "2026-03-10" }));
      const search = (extra: Partial<Parameters<BookRepository["search"]>[0]> = {}) => ctx.repo().search({ words: [tag], authorIds: null, limit: 10, offset: 0, ...extra });
      const ids = async (extra = {}) => (await search(extra)).map((x) => x.id);

      expect(await ids({ authorIds: [m1.id] })).toEqual([c, a]);
      expect(await ids({ authorIds: [m2.id] })).toEqual([b]);
      expect(await ids({ authorIds: [] })).toEqual([]);
      expect(await ids({ after: "2026-02-10T12:00:00Z" })).toEqual([c, b]);
      expect(await ids({ before: "2026-03-10" })).toEqual([b, a]);
      expect(await ids({ after: "2026-02-01", before: "2026-03-01" })).toEqual([b]);
      expect(await ids({ limit: 2 })).toEqual([c, b]);
      expect(await ids({ limit: 2, offset: 2 })).toEqual([a]);
    });

    it("treats % _ , ( ) and quotes in a search word as plain separators, not as wildcards or filter syntax", async () => {
      const [m1] = await ctx.members();
      const tag = ctx.unique("xq").toLowerCase().replace(/[^a-z0-9]/g, "");
      const id = await ctx.repo().add(book(m1.id, `${tag} plain`));
      expect((await ctx.repo().search({ words: [`${tag}%`], authorIds: null, limit: 10, offset: 0 })).map((b) => b.id)).toEqual([id]);
      expect(await ctx.repo().search({ words: [`${tag},("x`], authorIds: null, limit: 10, offset: 0 })).toBeDefined();
      expect(await ctx.repo().search({ words: ["%"], authorIds: [m1.id], limit: 1, offset: 0 })).toHaveLength(1);
    });

    it("reads every book past 1000 rows, on the shelf and in the counts", async () => {
      const [m1, m2] = await ctx.members();
      const ids: string[] = [];
      for (let start = 0; start < 1010; start += 50) {
        const batch = await Promise.all(Array.from({ length: Math.min(50, 1010 - start) }, (_, i) => ctx.repo().add(book(m2.id, ctx.unique(`bulk${start + i}`), { published_date: `2025-${String((i % 12) + 1).padStart(2, "0")}-01` }))));
        ids.push(...batch);
      }
      const shelf = (await ctx.repo().shelf()).map((b) => b.id);
      expect(new Set(shelf).size).toBe(shelf.length);
      expect(ids.every((id) => shelf.includes(id))).toBe(true);
      expect((await ctx.repo().liveCountsByMember()).get(m2.id)).toBe(1010);
      expect(await ctx.repo().countLive(m2.id)).toBe(1010);
      expect(await ctx.repo().countLive(m1.id)).toBe(0);
    }, 60_000);

    it("finds books whose cover is not a library image yet, and moves one only if its cover is still what was read", async () => {
      const [m1] = await ctx.members();
      const asset = await ctx.coverAsset(1600, 2560);
      const link = `https://pics.example.test/${ctx.unique("link")}.png`;
      const old = await ctx.repo().add(book(m1.id, ctx.unique("Legacy"), { cover_url: link }));
      const done = await ctx.repo().add(book(m1.id, ctx.unique("Done"), { cover_asset_id: asset }));
      const gone = await ctx.repo().add(book(m1.id, ctx.unique("Deleted legacy"), { cover_url: `${link}?deleted` }));
      await ctx.repo().remove(gone);

      const legacy = (await ctx.repo().withoutCoverAsset()).filter((b) => [old, done, gone].includes(b.id));
      expect(legacy).toHaveLength(2);
      expect(legacy).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: old, member_id: m1.id, cover_url: link }),
          expect.objectContaining({ id: gone, member_id: m1.id, cover_url: `${link}?deleted` }),
        ])
      );

      const moved = { url: `/api/media/${asset}/book_cover_shelf`, assetId: asset };
      expect(await ctx.repo().adoptCover(old, "https://pics.example.test/earlier.png", moved)).toBe(false);
      expect((await ctx.repo().mine(m1.id)).find((b) => b.id === old)).toMatchObject({ cover_url: link, cover_asset: null });

      expect(await ctx.repo().adoptCover(old, link, moved)).toBe(true);
      expect((await ctx.repo().mine(m1.id)).find((b) => b.id === old)).toMatchObject({ cover_url: moved.url, cover_asset: { id: asset } });
      expect(await ctx.repo().adoptCover(old, moved.url, moved)).toBe(false);
      expect((await ctx.repo().withoutCoverAsset()).some((b) => b.id === old)).toBe(false);
    });
  });
}
