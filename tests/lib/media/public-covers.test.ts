import { beforeEach, describe, expect, it, vi } from "vitest";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { eventSeed } from "@/tests/helpers/event-fixtures";
import { InMemoryMediaRepository } from "@/lib/data/media";

const config = vi.hoisted(() => ({ public: false }));
vi.mock("@/lib/config", () => ({
  ORG_TIMEZONE: "America/New_York",
  get BOOKSHELF_PUBLIC() {
    return config.public;
  },
}));

import { assetForVisitor, isPublicBookCover } from "@/lib/media/public-covers";

let data: InMemoryDataset;
let media: InMemoryMediaRepository;

const asset = (sha: string) => media.add({ storage_path: `originals/x/${sha}.png`, mime_type: "image/png", width: 1, height: 1, bytes: 1, sha256: sha, title: sha, owner_member_id: "mbr_AAAAAAAAAAA1" });

beforeEach(() => {
  config.public = false;
  data = new InMemoryDataset();
  media = new InMemoryMediaRepository(data);
});

describe("isPublicBookCover", () => {
  it("is false for everything while the Bookshelf isn't public", async () => {
    const cover = await asset("a");
    data.memberBooks.push({ id: "book_AAAAAAAAAAA1", member_id: "mbr_AAAAAAAAAAA1", title: "T", published_date: "2026-01-01", cover_asset_id: cover.id });
    expect(await isPublicBookCover(media, cover.id, "book_cover_shelf")).toBe(false);
  });

  it("is true for a book's cover at the shelf size once the Bookshelf is public", async () => {
    config.public = true;
    const cover = await asset("a");
    data.memberBooks.push({ id: "book_AAAAAAAAAAA1", member_id: "mbr_AAAAAAAAAAA1", title: "T", published_date: "2026-01-01", cover_asset_id: cover.id });
    expect(await isPublicBookCover(media, cover.id, "book_cover_shelf")).toBe(true);
  });

  it("stays false for the other sizes, a project's cover, an event's image and an image nothing uses", async () => {
    config.public = true;
    const bookCover = await asset("a");
    const projectCover = await asset("b");
    const eventImage = await asset("c");
    const unused = await asset("d");
    data.memberBooks.push({ id: "book_AAAAAAAAAAA1", member_id: "mbr_AAAAAAAAAAA1", title: "T", published_date: "2026-01-01", cover_asset_id: bookCover.id });
    data.writingProjects.push({ id: "wprj_AAAAAAAAAAA1", member_id: "mbr_AAAAAAAAAAA1", cover_asset_id: projectCover.id } as never);
    const seeded = eventSeed([{ id: "evt_AAAAAAAAAAA1", slug: "e", title: "E", image_id: eventImage.id }]);
    data.prickles.push(...seeded.prickles);
    data.events.push(...seeded.events);

    expect(await isPublicBookCover(media, bookCover.id, "book_cover_kdp_ebook")).toBe(false);
    expect(await isPublicBookCover(media, bookCover.id, "thumb")).toBe(false);
    for (const other of [projectCover, eventImage, unused]) expect(await isPublicBookCover(media, other.id, "book_cover_shelf")).toBe(false);
  });
});

describe("assetForVisitor", () => {
  it("gives a live image marked public, whatever the Bookshelf is doing", async () => {
    const shared = await asset("pub");
    await media.edit(shared.id, { is_public: true });
    expect((await assetForVisitor(media, shared.id, "thumb"))?.id).toBe(shared.id);
  });

  it("gives a book's cover at the shelf size only while the Bookshelf is public", async () => {
    const cover = await asset("cover");
    data.memberBooks.push({ id: "book_AAAAAAAAAAA1", member_id: "mbr_AAAAAAAAAAA1", title: "T", published_date: "2026-01-01", cover_asset_id: cover.id });
    expect(await assetForVisitor(media, cover.id, "book_cover_shelf")).toBeNull();
    config.public = true;
    expect((await assetForVisitor(media, cover.id, "book_cover_shelf"))?.id).toBe(cover.id);
    expect(await assetForVisitor(media, cover.id, "book_cover_kdp_ebook")).toBeNull();
  });

  it("gives nothing for an image that is private, deleted or doesn't exist", async () => {
    const privateOne = await asset("private");
    const gone = await asset("gone");
    await media.edit(gone.id, { is_public: true });
    await media.remove(gone.id);
    expect(await assetForVisitor(media, privateOne.id, "thumb")).toBeNull();
    expect(await assetForVisitor(media, gone.id, "thumb")).toBeNull();
    expect(await assetForVisitor(media, "media_AAAAAAAAAAAA", "thumb")).toBeNull();
  });

  it("answers nothing, not an error, when the library can't be read", async () => {
    vi.spyOn(media, "byId").mockRejectedValue(new Error("down"));
    expect(await assetForVisitor(media, "media_AAAAAAAAAAA1", "thumb")).toBeNull();
  });
});
