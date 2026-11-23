import { BAND_SPACE, pick } from "@/components/landing/theme";
import { APP_URL } from "@/lib/config";
import BookGrid from "./BookGrid";
import { BOOKSHELF_DEFAULT_FIRST_SHOWN, type BookCard } from "./live-books";

/**
 * The Hedgie Bookshelf block (docs/product/WRITER_PROFILES.md, "The public Hedgie Bookshelf"): a grid of the covers of the books members
 * keep at the globe, newest first, each with its title, the name on the book and, where there is one, the link to buy it. Static and
 * presentational like every block: the books arrive in a render-only `live` prop that `live-loader.ts` sets per render on the server
 * (never stored). With no live books (the read failed, or nobody shows one) it draws `emptyText`, or nothing.
 */

export type HedgieBookshelfProps = {
  heading: string;
  intro: string;
  /** Only books with a genre containing this (case-insensitive); empty = every genre. */
  genre: string;
  /** The most books to load (1 to 500). */
  max: number;
  /** How many show before "Show more books". */
  firstShown: number;
  /** What a page with no book to show says; empty draws nothing. */
  emptyText: string;
  padding?: "none" | "small" | "medium" | "large";
  live?: { books: BookCard[] };
  editing?: boolean;
};

/** What the editor shows in place of the live books, so the page can be laid out before anyone looks it up. */
const SAMPLE_BOOKS: BookCard[] = [
  { title: "The Lighthouse Letters", author: "Ada Example", cover: null, href: null, published: "2026-01-01" },
  { title: "A Year of Small Wonders", author: "Bo Example", cover: null, href: null, published: "2025-06-01" },
  { title: "Marmalade Skies", author: null, cover: null, href: null, published: "2025-02-01" },
];

/** The structured data of the books on the page (schema.org `Book`), for search engines. Only what the cards already show; `<` is escaped so no title can end the script. */
export function bookshelfJsonLd(books: BookCard[], siteUrl?: string): string {
  const data = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    itemListElement: books.slice(0, 100).map((book, i) => ({
      "@type": "ListItem",
      position: i + 1,
      item: {
        "@type": "Book",
        name: book.title,
        ...(book.author ? { author: { "@type": "Person", name: book.author } } : {}),
        datePublished: book.published,
        ...(book.href ? { url: book.href } : {}),
        ...(book.cover && siteUrl ? { image: `${siteUrl}${book.cover}` } : {}),
      },
    })),
  };
  return JSON.stringify(data).replace(/</g, "\\u003c");
}

export function HedgieBookshelf({ heading, intro, firstShown, emptyText, padding, live, editing }: HedgieBookshelfProps) {
  const books = live?.books.length ? live.books : editing ? SAMPLE_BOOKS : [];
  if (books.length === 0) {
    return emptyText ? (
      <section className={`text-center ${pick(BAND_SPACE.figures, padding, "small")}`}>
        <p>{emptyText}</p>
      </section>
    ) : null;
  }
  const first = Math.max(1, Math.floor(firstShown) || BOOKSHELF_DEFAULT_FIRST_SHOWN);
  return (
    <section className={pick(BAND_SPACE.figures, padding, "small")}>
      {heading && <h3 className="mb-2 text-center font-display text-3xl font-semibold">{heading}</h3>}
      {intro && <p className="mx-auto mb-8 max-w-2xl text-center">{intro}</p>}
      <BookGrid books={books} firstShown={first} step={first} />
      {live && <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: bookshelfJsonLd(books, APP_URL) }} />}
    </section>
  );
}
