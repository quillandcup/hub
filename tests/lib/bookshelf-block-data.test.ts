/**
 * The data side of the Hedgie Bookshelf block (src/modules/bookshelf/page-blocks): what a book becomes on a public page (the card),
 * what a block may ask for, and the loader that puts the books in a page for one render. The books come from the in-memory
 * repository, which tests/lib/data/books-in-memory.test.ts holds to the same contract as the table (private and house books never
 * reach the public shelf; the shelf pages past 1000 rows).
 */
import { describe, expect, it, vi } from "vitest";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { InMemoryBookRepository, type BookSeed } from "@/lib/data/books";
import { resolveLiveBlocks } from "@/lib/landing/live-data";
import { BOOKSHELF_DEFAULT_MAX, BOOKSHELF_MAX_BOOKS, bookCard, bookshelfOptions, coverFor } from "@/modules/bookshelf/page-blocks/live-books";
import { createBookshelfLoader, neededBookshelves } from "@/modules/bookshelf/page-blocks/live-loader";

const ADA = "mbr_AAAAAAAAAAA1";
const BO = "mbr_AAAAAAAAAAA2";

const book = (n: number, over: Partial<BookSeed> = {}): BookSeed => ({
  id: `book_${String(n).padStart(12, "A")}`,
  member_id: ADA,
  title: `Fake Book ${n}`,
  published_date: new Date(Date.UTC(2020, 0, 1) + n * 86_400_000).toISOString().slice(0, 10),
  cover_asset_id: null,
  cover_url: `/api/media/media_${String(n).padStart(12, "B")}/book_cover_shelf`,
  editions: [{ format: "print", purchase_url: `https://shop.example.test/${n}`, price: null }],
  ...over,
});

function shelf(books: BookSeed[]) {
  const data = new InMemoryDataset({
    members: [
      { id: ADA, name: "Ada Legalname", displayName: "Ada E." },
      { id: BO, name: "Bo Legalname" },
    ],
    memberBooks: books,
  });
  const repo = new InMemoryBookRepository(data);
  return createBookshelfLoader(async (options) => (await repo.publicShelf({ genre: options.genre, limit: options.max })).map(bookCard));
}

const page = (props: Record<string, unknown> = {}) => ({ content: [{ type: "HedgieBookshelf", props: { heading: "Shelf", ...props } }], root: { props: {} } });
const bookshelfProps = async (loader: ReturnType<typeof shelf>, props: Record<string, unknown> = {}) => {
  const out = (await resolveLiveBlocks(page(props), [loader])) as { content: { props: { live?: { books: ReturnType<typeof bookCard>[] } } }[] };
  return out.content[0].props;
};

describe("bookshelfOptions", () => {
  it("clamps the count to 1..500, defaults it, and trims and limits the genre", () => {
    expect(bookshelfOptions({})).toEqual({ genre: null, max: BOOKSHELF_DEFAULT_MAX });
    expect(bookshelfOptions({ max: 0 }).max).toBe(1);
    expect(bookshelfOptions({ max: -5 }).max).toBe(1);
    expect(bookshelfOptions({ max: 99999 }).max).toBe(BOOKSHELF_MAX_BOOKS);
    expect(bookshelfOptions({ max: 12.9 }).max).toBe(12);
    expect(bookshelfOptions({ max: "lots" }).max).toBe(BOOKSHELF_DEFAULT_MAX);
    expect(bookshelfOptions({ max: Number.NaN }).max).toBe(BOOKSHELF_DEFAULT_MAX);
    expect(bookshelfOptions({ genre: "  Fantasy " }).genre).toBe("Fantasy");
    expect(bookshelfOptions({ genre: "   " }).genre).toBeNull();
    expect(bookshelfOptions({ genre: 7 }).genre).toBeNull();
    expect(bookshelfOptions({ genre: "x".repeat(100) }).genre).toHaveLength(40);
  });
});

describe("bookCard", () => {
  const base = { title: "T", cover_url: "/api/media/media_AAAAAAAAAAAA/book_cover_shelf", published_date: "2026-01-01", genres: [], author: "A", purchase_url: "https://shop.example.test/t" };

  it("carries only what the page shows", () => {
    expect(bookCard(base)).toEqual({ title: "T", author: "A", cover: base.cover_url, href: "https://shop.example.test/t", published: "2026-01-01" });
  });

  it("drops a link that is not http or https, and a missing one", () => {
    expect(bookCard({ ...base, purchase_url: "javascript:alert(1)" }).href).toBeNull();
    expect(bookCard({ ...base, purchase_url: "data:text/html,hi" }).href).toBeNull();
    expect(bookCard({ ...base, purchase_url: "/relative" }).href).toBeNull();
    expect(bookCard({ ...base, purchase_url: null }).href).toBeNull();
    expect(bookCard({ ...base, purchase_url: "http://shop.example.test/x" }).href).toBe("http://shop.example.test/x");
  });

  it("uses only a cover the media library serves at the shelf size", () => {
    expect(coverFor("/api/media/media_AAAAAAAAAAAA/book_cover_shelf")).toBe("/api/media/media_AAAAAAAAAAAA/book_cover_shelf");
    expect(coverFor("/api/media/media_AAAAAAAAAAAA/book_cover_shelf?v=2026-01-01T00%3A00%3A00Z")).not.toBeNull();
    for (const bad of ["", "https://elsewhere.example.test/c.png", "//elsewhere.example.test/c.png", "/api/media/media_AAAAAAAAAAAA/book_cover_kdp_ebook", "/api/media/media_AAAAAAAAAAAA/original", "/api/media/x/book_cover_shelf", "javascript:alert(1)"]) {
      expect(coverFor(bad)).toBeNull();
    }
    expect(bookCard({ ...base, cover_url: "https://elsewhere.example.test/c.png" }).cover).toBeNull();
  });
});

describe("neededBookshelves", () => {
  it("asks nothing of a page with no Bookshelf block, and once for blocks that ask the same", () => {
    expect(neededBookshelves({ content: [{ type: "Heading", props: {} }], root: { props: {} } })).toEqual([]);
    const twice = { content: [{ type: "HedgieBookshelf", props: { genre: "Fantasy", max: 10 } }, { type: "HedgieBookshelf", props: { genre: "fantasy", max: 10 } }, { type: "HedgieBookshelf", props: {} }], root: { props: {} } };
    expect(neededBookshelves(twice)).toHaveLength(2);
  });
});

describe("the Bookshelf loader", () => {
  it("gives the block the books at the globe, newest first, and no private or house book", async () => {
    const loader = shelf([
      book(1, { visibility: "public" }),
      book(2, { visibility: "private" }),
      book(3, { visibility: "community" }),
      book(4, { visibility: "public" }),
      book(5, { visibility: "public", deleted_at: "2026-02-01T00:00:00Z" }),
    ]);
    const props = await bookshelfProps(loader);
    expect(props.live?.books.map((b) => b.title)).toEqual(["Fake Book 4", "Fake Book 1"]);
  });

  it("gives no live books, so the block draws its own empty line, when there are none", async () => {
    expect((await bookshelfProps(shelf([]))).live).toBeUndefined();
    expect((await bookshelfProps(shelf([book(1, { visibility: "private" })]))).live).toBeUndefined();
  });

  it("gives one book, and 1001 of them when the block asks for that many (more than a page of the table)", async () => {
    expect((await bookshelfProps(shelf([book(1)]))).live?.books).toHaveLength(1);
    const many = shelf(Array.from({ length: 1001 }, (_, i) => book(i)));
    expect((await bookshelfProps(many, { max: 500 })).live?.books).toHaveLength(500);
    expect((await bookshelfProps(many, { max: 60 })).live?.books).toHaveLength(60);
    // The most a block can ask for is 500, whatever is stored in the page.
    expect((await bookshelfProps(many, { max: 5000 })).live?.books).toHaveLength(BOOKSHELF_MAX_BOOKS);
  });

  it("names the author by the book's pen name, else the member's display name, else nobody, and never the legal name", async () => {
    const loader = shelf([
      book(1, { member_id: ADA, pen_name: "A. E. Byron" }),
      book(2, { member_id: ADA }),
      book(3, { member_id: BO }),
      book(4, { member_id: BO, pen_name: "B. Penn" }),
      book(5, { member_id: "mbr_ZZZZZZZZZZZZ" }),
    ]);
    const books = (await bookshelfProps(loader)).live!.books;
    expect(books.map((b) => [b.title, b.author])).toEqual([
      ["Fake Book 5", null],
      ["Fake Book 4", "B. Penn"],
      ["Fake Book 3", null],
      ["Fake Book 2", "Ada E."],
      ["Fake Book 1", "A. E. Byron"],
    ]);
    expect(JSON.stringify(books)).not.toContain("Legalname");
  });

  it("filters by genre when the block asks for one", async () => {
    const loader = shelf([book(1, { genres: ["Cozy Mystery"] }), book(2, { genres: ["Fantasy"] }), book(3, { genres: [] })]);
    expect((await bookshelfProps(loader, { genre: "mystery" })).live?.books.map((b) => b.title)).toEqual(["Fake Book 1"]);
    expect((await bookshelfProps(loader, { genre: "romance" })).live).toBeUndefined();
  });

  it("drops a `live` prop planted in the stored page, and keeps the page's own settings", async () => {
    const planted = { content: [{ type: "HedgieBookshelf", props: { heading: "Shelf", live: { books: [{ title: "Planted", author: "x", cover: null, href: "javascript:alert(1)", published: "2026-01-01" }] } } }], root: { props: {} } };
    const out = (await resolveLiveBlocks(planted, [shelf([])])) as { content: { props: Record<string, unknown> }[] };
    expect(out.content[0].props.live).toBeUndefined();
    expect(out.content[0].props.heading).toBe("Shelf");
  });

  it("logs by code and leaves the block with no books when the read fails, never an error on the page", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const failing = createBookshelfLoader(async () => {
      throw new Error("down");
    });
    expect((await bookshelfProps(failing)).live).toBeUndefined();
    expect(log).toHaveBeenCalledWith("landing_live_bookshelf_failed", "Error");
    log.mockRestore();
  });

  it("reads the books once for two blocks that ask the same, and not at all for a page without the block", async () => {
    const read = vi.fn(async () => []);
    const loader = createBookshelfLoader(read);
    await resolveLiveBlocks({ content: [{ type: "HedgieBookshelf", props: {} }, { type: "HedgieBookshelf", props: {} }], root: { props: {} } }, [loader]);
    expect(read).toHaveBeenCalledTimes(1);
    await resolveLiveBlocks({ content: [{ type: "Heading", props: {} }], root: { props: {} } }, [loader]);
    expect(read).toHaveBeenCalledTimes(1);
  });
});
