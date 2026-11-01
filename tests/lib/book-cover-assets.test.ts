import { beforeEach, describe, expect, it, vi } from "vitest";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { InMemoryMediaRepository } from "@/lib/data/media";
import { releaseReplacedCover, resolveBookCover } from "@/lib/book-cover-assets";

const ME = "mbr_AAAAAAAAAAA1";
const OTHER = "mbr_AAAAAAAAAAA2";
let data: InMemoryDataset;
let media: InMemoryMediaRepository;

const asset = (owner: string | null, sha: string) =>
  media.add({ storage_path: `originals/${owner ?? "shared"}/${sha}.png`, mime_type: "image/png", width: 100, height: 150, bytes: 1, sha256: sha, title: sha, owner_member_id: owner });

beforeEach(() => {
  data = new InMemoryDataset();
  media = new InMemoryMediaRepository(data);
});

describe("resolveBookCover", () => {
  it("accepts the member's own library cover and rebuilds its URL from the id", async () => {
    const mine = await asset(ME, "a");
    expect(await resolveBookCover(media, ME, `/api/media/${mine.id}/book_cover_shelf`)).toEqual({ url: `/api/media/${mine.id}/book_cover_shelf`, assetId: mine.id });
  });

  it("accepts an ordinary link as an older cover, with no asset", async () => {
    expect(await resolveBookCover(media, ME, "https://example.com/cover.jpg")).toEqual({ url: "https://example.com/cover.jpg", assetId: null });
  });

  it("refuses another member's image, a shared one, a deleted one and one that doesn't exist", async () => {
    const theirs = await asset(OTHER, "b");
    const shared = await asset(null, "c");
    const gone = await asset(ME, "d");
    await media.remove(gone.id);
    for (const id of [theirs.id, shared.id, gone.id, "media_AAAAAAAAAAAA"]) {
      expect(await resolveBookCover(media, ME, `/api/media/${id}/book_cover_shelf`)).toEqual({ error: "That cover isn't one of yours: upload it again" });
    }
  });

  it("refuses an unsafe or empty cover", async () => {
    for (const bad of ["javascript:alert(1)", "", null, undefined, "/api/media/anything"]) {
      expect(await resolveBookCover(media, ME, bad)).toEqual({ error: "Cover image failed to upload correctly — try again" });
    }
  });

  it("treats a library that can't be read as not theirs", async () => {
    vi.spyOn(media, "byId").mockRejectedValue(new Error("down"));
    expect(await resolveBookCover(media, ME, "/api/media/media_AAAAAAAAAAA1/book_cover_shelf")).toEqual({ error: "That cover isn't one of yours: upload it again" });
  });
});

describe("releaseReplacedCover", () => {
  it("removes the old cover when nothing uses it any more", async () => {
    const old = await asset(ME, "old");
    await releaseReplacedCover(media, ME, old.id, "media_NEWNEWNEWNE1");
    expect((await media.byId(old.id))?.deleted_at).not.toBeNull();
  });

  it("keeps it while a book or a project still shows it", async () => {
    const byBook = await asset(ME, "byBook");
    const byProject = await asset(ME, "byProject");
    data.memberBooks.push({ id: "book_AAAAAAAAAAA1", member_id: ME, title: "T", published_date: "2026-01-01", cover_asset_id: byBook.id });
    data.writingProjects.push({ id: "wprj_AAAAAAAAAAA1", member_id: ME, cover_asset_id: byProject.id } as never);
    await releaseReplacedCover(media, ME, byBook.id, null);
    await releaseReplacedCover(media, ME, byProject.id, null);
    expect((await media.byId(byBook.id))?.deleted_at).toBeNull();
    expect((await media.byId(byProject.id))?.deleted_at).toBeNull();
  });

  it("does nothing when there was no library cover, the cover didn't change, or the image isn't theirs", async () => {
    const same = await asset(ME, "same");
    const theirs = await asset(OTHER, "theirs");
    const shared = await asset(null, "shared");
    await releaseReplacedCover(media, ME, null, same.id);
    await releaseReplacedCover(media, ME, same.id, same.id);
    await releaseReplacedCover(media, ME, theirs.id, null);
    await releaseReplacedCover(media, ME, shared.id, null);
    await releaseReplacedCover(media, ME, "media_AAAAAAAAAAAA", null);
    for (const a of [same, theirs, shared]) expect((await media.byId(a.id))?.deleted_at).toBeNull();
  });

  it("never throws: a failure only leaves an unused image behind", async () => {
    const old = await asset(ME, "old2");
    vi.spyOn(media, "usages").mockRejectedValue(new Error("down"));
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(releaseReplacedCover(media, ME, old.id, null)).resolves.toBeUndefined();
    expect(log).toHaveBeenCalled();
    expect((await media.byId(old.id))?.deleted_at).toBeNull();
  });
});
