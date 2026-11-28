// @vitest-environment jsdom
/**
 * The public Hedgie Bookshelf page (src/app/public-bookshelf, answering at /bookshelf for visitors who are not signed in): which books
 * a visitor sees (only the globe, never the house level or a private book), the author line, the cover and its alt text, the search
 * tags, the sitemap entry, and that a signed-in member goes to the member page instead. The repository is the in-memory twin, which
 * tests/lib/data/books-in-memory.test.ts holds to the table's contract (including 999, 1000, 1001 and 2000 rows).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, within } from "@testing-library/react";
import { expectRedirect, renderServerPage, resetServerPageMocks, signInAs, MEMBER_USER } from "@/tests/helpers/server-page";
import { APP_URL } from "@/lib/config";
import { InMemoryDataset } from "@/lib/data/in-memory";
import type { BookSeed } from "@/lib/data/books";
import { createInMemoryRepos } from "@/lib/data/repos";
import { BOOKSHELF_MAX_BOOKS } from "@/modules/bookshelf/page-blocks/live-books";

vi.hoisted(() => {
  const g = globalThis as Record<string, unknown>;
  g.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

vi.mock("next/navigation", () => import("@/tests/helpers/server-page").then((m) => m.nextNavigationModule));
vi.mock("@/lib/auth", () => import("@/tests/helpers/server-page").then((m) => m.authModule));
const state = { repos: createInMemoryRepos(new InMemoryDataset()) };
vi.mock("@/lib/data/server", () => ({ getServiceRepos: () => state.repos }));
// The real cache needs a running Next server; its one-minute setting is checked in tests/lib/landing-live-server.test.ts.
vi.mock("next/cache", () => ({ unstable_cache: (fn: (...args: never[]) => unknown) => fn }));

import PublicBookshelfPage, { metadata } from "@/app/public-bookshelf/page";
import sitemap from "@/app/sitemap";

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

function seed(books: BookSeed[]) {
  state.repos = createInMemoryRepos(
    new InMemoryDataset({
      members: [
        { id: ADA, name: "Ada Legalname", displayName: "Ada E." },
        { id: BO, name: "Bo Legalname" },
      ],
      memberBooks: books,
    }),
  );
}

beforeEach(() => {
  resetServerPageMocks();
  signInAs(null);
  seed([]);
});

describe("/public-bookshelf as a visitor", () => {
  it("shows only books at the globe: never the house level, a private book or a deleted one", async () => {
    seed([
      book(1),
      book(2, { visibility: "community" }),
      book(3, { visibility: "private" }),
      book(4, { deleted_at: "2026-02-01T00:00:00Z" }),
      book(5),
    ]);
    await renderServerPage(PublicBookshelfPage, {});
    const list = screen.getByRole("list", { name: "Books by our members" });
    const titles = within(list).getAllByRole("listitem").map((li) => li.querySelector("p")?.textContent);
    expect(titles).toEqual(["Fake Book 5", "Fake Book 1"]);
  });

  it("has one top heading, the cover with alt text and the link to get the book", async () => {
    seed([book(1)]);
    await renderServerPage(PublicBookshelfPage, {});
    expect(screen.getByRole("heading", { level: 1, name: "The Hedgie Bookshelf" })).toBeInTheDocument();
    expect(screen.getByAltText("Cover of Fake Book 1")).toHaveAttribute("src", expect.stringMatching(/^\/api\/media\/media_\w+\/book_cover_shelf$/));
    expect(screen.getByRole("link", { name: /Fake Book 1.*where to get it/ })).toHaveAttribute("href", "https://shop.example.test/1");
  });

  it("names the pen name, else the display name, else nothing, and never the legal name", async () => {
    seed([
      book(1, { pen_name: "A. Pen" }),
      book(2),
      book(3, { member_id: BO }),
    ]);
    const { container } = await renderServerPage(PublicBookshelfPage, {});
    const text = container.textContent ?? "";
    expect(text).toContain("by A. Pen");
    expect(text).toContain("by Ada E.");
    expect(text).not.toContain("Legalname");
    // The card of a book with no name has the title and no author line.
    const card = screen.getByText("Fake Book 3").closest("li") as HTMLElement;
    expect(card.textContent).toBe("Fake Book 3");
  });

  it("shows no member id, book id, description or member photo", async () => {
    seed([book(1, { description: "A private-ish blurb" })]);
    const { container } = await renderServerPage(PublicBookshelfPage, {});
    const html = container.innerHTML;
    expect(html).not.toContain(ADA);
    expect(html).not.toContain(book(1).id);
    expect(html).not.toContain("private-ish blurb");
  });

  it("says so when there are no books yet", async () => {
    await renderServerPage(PublicBookshelfPage, {});
    expect(screen.getByText("No books on the shelf yet. Check back soon.")).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "Books by our members" })).toBeNull();
  });

  it("has every book in the page and hides the ones past the first screenful behind Show more books", async () => {
    seed(Array.from({ length: 30 }, (_, i) => book(i + 1)));
    await renderServerPage(PublicBookshelfPage, {});
    const cards = screen.getAllByRole("listitem", { hidden: true });
    expect(cards).toHaveLength(30);
    expect(cards.filter((c) => c.hasAttribute("hidden"))).toHaveLength(6);
    expect(screen.getByRole("button", { name: "Show more books" })).toBeInTheDocument();
  });

  it("reads past a thousand books (the block's cap, 500, is what one page loads)", async () => {
    seed(Array.from({ length: 1050 }, (_, i) => book(i + 1)));
    await renderServerPage(PublicBookshelfPage, {});
    expect(screen.getAllByRole("listitem", { hidden: true })).toHaveLength(BOOKSHELF_MAX_BOOKS);
    // Newest first: the cap drops the oldest, not the newest.
    expect(screen.getByText("Fake Book 1050")).toBeInTheDocument();
  });

  it("lists the books as structured data, with the site address on covers", async () => {
    seed([book(1)]);
    const { container } = await renderServerPage(PublicBookshelfPage, {});
    const ld = container.querySelector('script[type="application/ld+json"]');
    const data = JSON.parse(ld?.textContent ?? "{}");
    expect(data.itemListElement[0].item.name).toBe("Fake Book 1");
    expect((data.itemListElement[0].item.image as string).startsWith(`${APP_URL}/api/media/`)).toBe(true);
  });
});

describe("/public-bookshelf for a signed-in member", () => {
  it("sends them to the member Bookshelf at /bookshelf", async () => {
    signInAs(MEMBER_USER);
    await expectRedirect(PublicBookshelfPage, {}, "/bookshelf");
  });
});

describe("search tags and sitemap", () => {
  it("is indexable, with a title, description and the /bookshelf address as canonical and Open Graph address", () => {
    expect(metadata.title).toBe("The Hedgie Bookshelf");
    expect(metadata.description).toMatch(/Books written by the members/);
    expect(metadata.alternates?.canonical).toBe(`${APP_URL}/bookshelf`);
    expect(metadata.openGraph).toMatchObject({ url: `${APP_URL}/bookshelf`, title: "The Hedgie Bookshelf" });
    expect(metadata.robots).toEqual({ index: true, follow: true });
  });

  it("is in the site's sitemap at its public address", () => {
    expect(sitemap()).toEqual([{ url: `${APP_URL}/bookshelf` }]);
  });
});
