// @vitest-environment jsdom
/**
 * The Hedgie Bookshelf page block (src/modules/bookshelf/page-blocks): what a visitor sees for no books, one book and more than a
 * thousand, the author line, the cover and the link, the "Show more books" control, the structured data, and what the editor shows.
 */
import { describe, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach } from "vitest";
import { HedgieBookshelf, bookshelfJsonLd } from "@/modules/bookshelf/page-blocks/blocks";
import type { BookCard } from "@/modules/bookshelf/page-blocks/live-books";

afterEach(cleanup);

const card = (n: number, over: Partial<BookCard> = {}): BookCard => ({
  title: `Fake Book ${n}`,
  author: `Ada Example ${n}`,
  cover: `/api/media/media_AAAAAAAAAA${String(n % 10)}A/book_cover_shelf`,
  href: `https://shop.example.test/book-${n}`,
  published: "2026-01-01",
  ...over,
});

const props = { heading: "The Hedgie Bookshelf", intro: "Books written by our members.", genre: "", max: 60, firstShown: 24, emptyText: "" };

describe("HedgieBookshelf", () => {
  it("draws nothing at all for a visitor when there are no books and no line to say so", () => {
    const { container } = render(<HedgieBookshelf {...props} />);
    expect(container).toBeEmptyDOMElement();
    cleanup();
    const live = render(<HedgieBookshelf {...props} live={{ books: [] }} />);
    expect(live.container).toBeEmptyDOMElement();
  });

  it("says the line it was given when there are no books", () => {
    render(<HedgieBookshelf {...props} emptyText="Our first books are coming." />);
    expect(screen.getByText("Our first books are coming.")).toBeInTheDocument();
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
  });

  it("draws one book: its cover with alt text, its title, the author line and the link to buy it", () => {
    render(<HedgieBookshelf {...props} live={{ books: [card(1)] }} />);
    expect(screen.getByRole("heading", { level: 3, name: "The Hedgie Bookshelf" })).toBeInTheDocument();
    expect(screen.getByText("Books written by our members.")).toBeInTheDocument();
    const item = screen.getByRole("listitem");
    expect(within(item).getByAltText("Cover of Fake Book 1")).toHaveAttribute("src", "/api/media/media_AAAAAAAAAA1A/book_cover_shelf");
    expect(within(item).getByText("Fake Book 1")).toBeInTheDocument();
    expect(within(item).getByText("by Ada Example 1")).toBeInTheDocument();
    const link = within(item).getByRole("link", { name: "Fake Book 1, by Ada Example 1: where to get it" });
    expect(link).toHaveAttribute("href", "https://shop.example.test/book-1");
    expect(link.getAttribute("rel")).toContain("noopener");
    expect(link.getAttribute("rel")).toContain("nofollow");
    // One book: nothing to show more of.
    expect(screen.queryByRole("button", { name: "Show more books" })).not.toBeInTheDocument();
  });

  it("shows a book with no author line, no link and no cover as a card with a placeholder, not a broken one", () => {
    render(<HedgieBookshelf {...props} live={{ books: [card(2, { author: null, href: null, cover: null })] }} />);
    const item = screen.getByRole("listitem");
    expect(within(item).queryByText(/^by /)).not.toBeInTheDocument();
    expect(within(item).queryByRole("link")).not.toBeInTheDocument();
    expect(within(item).queryByRole("img", { name: /Cover of/ })).not.toBeInTheDocument();
    expect(within(item).getByRole("img", { name: "Fake Book 2: no cover yet" })).toBeInTheDocument();
    expect(item.querySelector("img")).toBeNull();
  });

  it("keeps every one of 1001 books in the page, with the first screenful showing and a button for the rest", async () => {
    const books = Array.from({ length: 1001 }, (_, i) => card(i));
    render(<HedgieBookshelf {...props} firstShown={24} live={{ books }} />);
    const items = screen.getAllByRole("listitem", { hidden: true });
    expect(items).toHaveLength(1001);
    expect(items.filter((li) => li.hasAttribute("hidden"))).toHaveLength(1001 - 24);
    expect(screen.getAllByRole("listitem")).toHaveLength(24);

    await userEvent.click(screen.getByRole("button", { name: "Show more books" }));
    expect(screen.getAllByRole("listitem")).toHaveLength(48);
    // Pressing until the end removes the button.
    for (let i = 0; i < 45; i++) {
      const more = screen.queryByRole("button", { name: "Show more books" });
      if (!more) break;
      await userEvent.click(more);
    }
    expect(screen.getAllByRole("listitem")).toHaveLength(1001);
    expect(screen.queryByRole("button", { name: "Show more books" })).not.toBeInTheDocument();
  });

  it("shows sample books in the editor so the page can be laid out, and none to a visitor", () => {
    const editing = render(<HedgieBookshelf {...props} editing />);
    expect(editing.container.querySelectorAll("li").length).toBeGreaterThan(0);
    cleanup();
    const visitor = render(<HedgieBookshelf {...props} />);
    expect(visitor.container.querySelectorAll("li")).toHaveLength(0);
  });

  it("lists the books to search engines as structured data, escaped so no title can close the script, with no ids", () => {
    const { container } = render(<HedgieBookshelf {...props} live={{ books: [card(3, { title: "</script><b>Fake</b> & Co" })] }} />);
    const script = container.querySelector('script[type="application/ld+json"]')!;
    expect(script.innerHTML).not.toContain("</script>");
    const data = JSON.parse(script.textContent!);
    expect(data["@type"]).toBe("ItemList");
    expect(data.itemListElement[0].item).toMatchObject({ "@type": "Book", name: "</script><b>Fake</b> & Co", author: { "@type": "Person", name: "Ada Example 3" }, datePublished: "2026-01-01", url: "https://shop.example.test/book-3" });
    expect(JSON.stringify(data)).not.toMatch(/"id"|book_[1-9A-Za-z]{12}|mbr_/);
  });

  it("leaves the author out of the structured data when the book has none, and caps it at 100 books", () => {
    const ld = JSON.parse(bookshelfJsonLd([card(4, { author: null }), ...Array.from({ length: 150 }, (_, i) => card(i + 10))], "https://hub.example.test"));
    expect(ld.itemListElement).toHaveLength(100);
    expect(ld.itemListElement[0].item.author).toBeUndefined();
    expect(ld.itemListElement[0].item.image).toBe("https://hub.example.test/api/media/media_AAAAAAAAAA4A/book_cover_shelf");
  });

  it("does not draw the structured data for the editor's sample books", () => {
    const { container } = render(<HedgieBookshelf {...props} editing />);
    expect(container.querySelector('script[type="application/ld+json"]')).toBeNull();
  });
});
