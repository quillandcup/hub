import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { InMemoryMediaRepository } from "@/lib/data/media";
import { InMemoryWritingRepository } from "@/lib/data/writing";
import { InMemoryBookRepository } from "@/lib/data/books";
import { adoptLegacyCovers, type LegacyCover } from "@/lib/media/adopt-covers";
import { solidImage } from "@/tests/helpers/media-fixtures";

const SUPABASE = "http://127.0.0.1:54321";
const OWN = `${SUPABASE}/storage/v1/object/public/book-covers/mbr_AAAAAAAAAAA1/old.jpg`;
const LINK = "https://pics.example.test/big.png";
const ME = "mbr_AAAAAAAAAAA1";
const OTHER = "mbr_AAAAAAAAAAA2";

let data: InMemoryDataset;
let media: InMemoryMediaRepository;
let writing: InMemoryWritingRepository;
let upload: ReturnType<typeof vi.fn>;
let images: Record<string, Buffer | { error: string }>;
let books: InMemoryBookRepository;

/** Puts books with an older cover on the shelf. */
const shelve = (covers: LegacyCover[]) =>
  data.memberBooks.push(...covers.map((c) => ({ id: c.id, member_id: c.memberId, title: c.title, cover_url: c.url, published_date: "2026-01-01", cover_asset_id: null })));
/** The library image each book points at now, by book id (a book still on its link is left out). */
const adopted = () => data.memberBooks.filter((b) => b.cover_asset_id).map((b) => ({ id: b.id, assetId: b.cover_asset_id }));
const storage = () => ({ from: () => ({ upload }) }) as unknown as SupabaseClient["storage"];
const run = (apply: boolean, extra: { onProgress?: (done: number, total: number) => void } = {}) =>
  adoptLegacyCovers(
    {
      media,
      writing,
      books,
      storage: storage(),
      supabaseUrl: SUPABASE,
      fetchCover: async (_s, _u, url) => {
        const found = images[url];
        if (!found) return { error: "HTTP 404" };
        return "error" in found ? found : { bytes: found };
      },
      ...extra,
    },
    { apply }
  );
const project = (id: string, memberId: string, coverUrl: string | null) =>
  data.writingProjects.push({ id, member_id: memberId, title: `Title ${id}`, phase: "drafting", description: null, cover_url: coverUrl, cover_asset_id: null, external_id: null, show_on_profile: false, archived_at: null, created_at: "2026-01-01T00:00:00Z" } as never);

beforeEach(async () => {
  data = new InMemoryDataset();
  media = new InMemoryMediaRepository(data);
  writing = new InMemoryWritingRepository(data);
  books = new InMemoryBookRepository(data);
  upload = vi.fn().mockResolvedValue({ error: null });
  images = { [OWN]: await solidImage(145, 215, "jpeg", { r: 10, g: 20, b: 30 }), [LINK]: await solidImage(1600, 2560, "png", { r: 40, g: 50, b: 60 }) };
});

describe("adoptLegacyCovers: a dry run", () => {
  it("reads every cover and reports where they come from and which are big enough for Amazon, writing nothing", async () => {
    shelve([
      { kind: "book", id: "book_AAAAAAAAAAA1", memberId: ME, title: "Old shelf", url: OWN },
      { kind: "book", id: "book_AAAAAAAAAAA2", memberId: OTHER, title: "Linked", url: LINK },
    ]);
    project("wprj_AAAAAAAAAAA1", ME, LINK);

    const report = await run(false);

    expect(report).toEqual({ dryRun: true, considered: 3, adopted: 3, fromOwnBucket: 1, fromLinks: 2, amazonReady: 2, tooSmallForAmazon: 1, failed: [] });
    expect(data.mediaAssets).toHaveLength(0);
    expect(upload).not.toHaveBeenCalled();
    expect(adopted()).toEqual([]);
    expect(data.writingProjects[0].cover_asset_id).toBeNull();
  });

  it("reports a cover it can't read or that isn't a picture, with the id and why", async () => {
    images["https://pics.example.test/page.html"] = Buffer.from("<html>");
    images["https://pics.example.test/blocked.png"] = { error: "not a public address" };
    shelve([
      { kind: "book", id: "book_AAAAAAAAAAA1", memberId: ME, title: "t", url: "https://pics.example.test/page.html" },
      { kind: "book", id: "book_AAAAAAAAAAA2", memberId: ME, title: "t", url: "https://pics.example.test/blocked.png" },
      { kind: "book", id: "book_AAAAAAAAAAA3", memberId: ME, title: "t", url: "https://pics.example.test/missing.png" },
    ]);
    const report = await run(false);
    expect(report.adopted).toBe(0);
    expect(report.failed).toEqual([
      { kind: "book", id: "book_AAAAAAAAAAA1", reason: expect.stringMatching(/doesn't look like an image/) },
      { kind: "book", id: "book_AAAAAAAAAAA2", reason: "not a public address" },
      { kind: "book", id: "book_AAAAAAAAAAA3", reason: "HTTP 404" },
    ]);
  });
});

describe("adoptLegacyCovers: applying", () => {
  it("stores each cover as its member's own library image and points the book and the project at it", async () => {
    shelve([{ kind: "book", id: "book_AAAAAAAAAAA1", memberId: ME, title: "My Book", url: OWN }]);
    project("wprj_AAAAAAAAAAA1", OTHER, LINK);

    const report = await run(true);

    expect(report).toMatchObject({ dryRun: false, considered: 2, adopted: 2, failed: [] });
    expect(data.mediaAssets).toHaveLength(2);
    const bookAsset = data.mediaAssets.find((a) => a.owner_member_id === ME)!;
    expect(bookAsset).toMatchObject({ title: "My Book", width: 145, height: 215, source: "upload" });
    expect(adopted()).toEqual([{ id: "book_AAAAAAAAAAA1", assetId: bookAsset.id }]);
    expect(data.memberBooks[0].cover_url).toBe(`/api/media/${bookAsset.id}/book_cover_shelf`);
    const projectAsset = data.mediaAssets.find((a) => a.owner_member_id === OTHER)!;
    expect(data.writingProjects[0]).toMatchObject({ cover_url: `/api/media/${projectAsset.id}/book_cover_shelf`, cover_asset_id: projectAsset.id });
    expect(upload).toHaveBeenCalledTimes(2);
  });

  it("makes a book and the project it came from share one image when they share the cover", async () => {
    shelve([{ kind: "book", id: "book_AAAAAAAAAAA1", memberId: ME, title: "T", url: LINK }]);
    project("wprj_AAAAAAAAAAA1", ME, LINK);
    await run(true);
    expect(data.mediaAssets).toHaveLength(1);
    expect(adopted()[0].assetId).toBe(data.mediaAssets[0].id);
    expect(data.writingProjects[0].cover_asset_id).toBe(data.mediaAssets[0].id);
  });

  it("is safe to run again: what was moved is left alone", async () => {
    project("wprj_AAAAAAAAAAA1", ME, LINK);
    await run(true);
    upload.mockClear();
    const again = await run(true);
    expect(again).toMatchObject({ considered: 0, adopted: 0 });
    expect(upload).not.toHaveBeenCalled();
    expect(data.mediaAssets).toHaveLength(1);
  });

  it("ignores a cover that is already a library image, a project with no cover, and an archived-cover-less project", async () => {
    project("wprj_AAAAAAAAAAA1", ME, "/api/media/media_AAAAAAAAAAA1/book_cover_shelf");
    project("wprj_AAAAAAAAAAA2", ME, null);
    shelve([{ kind: "book", id: "book_AAAAAAAAAAA1", memberId: ME, title: "t", url: "/api/media/media_AAAAAAAAAAA1/book_cover_shelf" }]);
    expect((await run(true)).considered).toBe(0);
  });

  it("leaves a book alone and says so when its cover changed while this ran", async () => {
    shelve([{ kind: "book", id: "book_AAAAAAAAAAA1", memberId: ME, title: "T", url: LINK }]);
    vi.spyOn(books, "adoptCover").mockResolvedValue(false);
    const report = await run(true);
    expect(report.adopted).toBe(0);
    expect(report.failed).toEqual([{ kind: "book", id: "book_AAAAAAAAAAA1", reason: "its cover changed while this ran; left as it is" }]);
  });

  it("reports a cover the library refuses or a write that throws, and carries on with the rest", async () => {
    images["https://pics.example.test/page.html"] = Buffer.from("<html>");
    shelve([
      { kind: "book", id: "book_AAAAAAAAAAA1", memberId: ME, title: "t", url: "https://pics.example.test/page.html" },
      { kind: "book", id: "book_AAAAAAAAAAA2", memberId: ME, title: "t", url: LINK },
    ]);
    project("wprj_AAAAAAAAAAA3", OTHER, OWN);
    vi.spyOn(writing, "updateProject").mockRejectedValue(new Error("write failed"));

    const report = await run(true);

    expect(report.adopted).toBe(1);
    expect(report.failed).toEqual([
      { kind: "book", id: "book_AAAAAAAAAAA1", reason: expect.stringMatching(/doesn't look like an image/) },
      { kind: "project", id: "wprj_AAAAAAAAAAA3", reason: "write failed" },
    ]);
  });

  it("tells the caller how far it has got", async () => {
    shelve([
      { kind: "book", id: "book_AAAAAAAAAAA1", memberId: ME, title: "t", url: OWN },
      { kind: "book", id: "book_AAAAAAAAAAA2", memberId: ME, title: "t", url: LINK },
    ]);
    const progress = vi.fn();
    await run(false, { onProgress: progress });
    expect(progress.mock.calls).toEqual([[1, 2], [2, 2]]);
  });
});
