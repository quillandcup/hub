import { beforeEach, describe, expect, it, vi } from "vitest";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { eventSeed } from "@/tests/helpers/event-fixtures";
import { InMemoryMediaRepository } from "@/lib/data/media";
import { InMemoryBookRepository } from "@/lib/data/books";

import { assetForVisitor, isPublicBookCover } from "@/lib/media/public-covers";

let data: InMemoryDataset;
let media: InMemoryMediaRepository;
let books: InMemoryBookRepository;
let repos: { media: InMemoryMediaRepository; books: InMemoryBookRepository };

const asset = (sha: string) => media.add({ storage_path: `originals/x/${sha}.png`, mime_type: "image/png", width: 1, height: 1, bytes: 1, sha256: sha, title: sha, owner_member_id: "mbr_AAAAAAAAAAA1" });
const book = (coverAssetId: string, extra: Record<string, unknown> = {}) =>
  data.memberBooks.push({ id: "book_AAAAAAAAAAA1", member_id: "mbr_AAAAAAAAAAA1", title: "T", published_date: "2026-01-01", cover_asset_id: coverAssetId, ...extra });

beforeEach(() => {
  data = new InMemoryDataset();
  media = new InMemoryMediaRepository(data);
  books = new InMemoryBookRepository(data);
  repos = { media, books };
});

describe("isPublicBookCover", () => {
  it("is true for the cover of a book at the globe, at the shelf size", async () => {
    const cover = await asset("a");
    book(cover.id);
    expect(await isPublicBookCover(books, cover.id, "book_cover_shelf")).toBe(true);
  });

  it("is false for a book that is private or for members only, and for one that was removed", async () => {
    const cover = await asset("a");
    book(cover.id, { visibility: "private" });
    expect(await isPublicBookCover(books, cover.id, "book_cover_shelf")).toBe(false);
    data.memberBooks[0].visibility = "community";
    expect(await isPublicBookCover(books, cover.id, "book_cover_shelf")).toBe(false);
    data.memberBooks[0].visibility = "public";
    data.memberBooks[0].deleted_at = "2026-02-01T00:00:00Z";
    expect(await isPublicBookCover(books, cover.id, "book_cover_shelf")).toBe(false);
  });

  it("stays false for the other sizes, a project's cover, an event's image and an image nothing uses", async () => {
    const bookCover = await asset("a");
    const projectCover = await asset("b");
    const eventImage = await asset("c");
    const unused = await asset("d");
    book(bookCover.id);
    data.writingProjects.push({ id: "wprj_AAAAAAAAAAA1", member_id: "mbr_AAAAAAAAAAA1", cover_asset_id: projectCover.id } as never);
    const seeded = eventSeed([{ id: "evt_AAAAAAAAAAA1", slug: "e", title: "E", image_id: eventImage.id }]);
    data.prickles.push(...seeded.prickles);
    data.events.push(...seeded.events);

    expect(await isPublicBookCover(books, bookCover.id, "book_cover_kdp_ebook")).toBe(false);
    expect(await isPublicBookCover(books, bookCover.id, "thumb")).toBe(false);
    for (const other of [projectCover, eventImage, unused]) expect(await isPublicBookCover(books, other.id, "book_cover_shelf")).toBe(false);
  });
});

describe("assetForVisitor", () => {
  it("gives a live image marked public", async () => {
    const shared = await asset("pub");
    await media.edit(shared.id, { is_public: true });
    expect((await assetForVisitor(repos, shared.id, "thumb"))?.id).toBe(shared.id);
  });

  it("gives a cover at the shelf size only while its book is at the globe", async () => {
    const cover = await asset("cover");
    book(cover.id, { visibility: "community" });
    expect(await assetForVisitor(repos, cover.id, "book_cover_shelf")).toBeNull();
    data.memberBooks[0].visibility = "public";
    expect((await assetForVisitor(repos, cover.id, "book_cover_shelf"))?.id).toBe(cover.id);
    expect(await assetForVisitor(repos, cover.id, "book_cover_kdp_ebook")).toBeNull();
    data.memberBooks[0].visibility = "private";
    expect(await assetForVisitor(repos, cover.id, "book_cover_shelf")).toBeNull();
  });

  it("gives nothing for an image that is private, deleted or doesn't exist", async () => {
    const privateOne = await asset("private");
    const gone = await asset("gone");
    await media.edit(gone.id, { is_public: true });
    await media.remove(gone.id);
    expect(await assetForVisitor(repos, privateOne.id, "thumb")).toBeNull();
    expect(await assetForVisitor(repos, gone.id, "thumb")).toBeNull();
    expect(await assetForVisitor(repos, "media_AAAAAAAAAAAA", "thumb")).toBeNull();
  });

  it("answers nothing, not an error, when the library can't be read", async () => {
    vi.spyOn(media, "byId").mockRejectedValue(new Error("down"));
    expect(await assetForVisitor(repos, "media_AAAAAAAAAAA1", "thumb")).toBeNull();
  });
});
