import { APP_URL } from "@/lib/config";

/**
 * The public Hedgie Bookshelf page (docs/product/WRITER_PROFILES.md, "The public Hedgie Bookshelf"). One address, `/bookshelf`: a
 * signed-in member gets the member page there (the shelf of the Hub, with the house level and their own books), and a visitor who
 * is not signed in is rewritten by the proxy to `PUBLIC_BOOKSHELF_RENDER_PATH`, a page of globe-level books only (the same way a
 * signed-out visit to a course address is shown its public preview, src/lib/courses/preview-path.ts). Pure, so the proxy can use it.
 */

/** The address everyone uses, and the one search engines and links name. */
export const BOOKSHELF_PATH = "/bookshelf";
/** Where the proxy sends a signed-out visit to `BOOKSHELF_PATH`. Not linked anywhere itself; a signed-in visit to it goes back to `BOOKSHELF_PATH`. */
export const PUBLIC_BOOKSHELF_RENDER_PATH = "/public-bookshelf";
/** The sitemap that lists the public pages of the site that are not one per member (src/app/sitemap.ts). */
export const SITE_SITEMAP_PATH = "/sitemap.xml";

export const PUBLIC_BOOKSHELF_TITLE = "The Hedgie Bookshelf";
export const PUBLIC_BOOKSHELF_DESCRIPTION = "Books written by the members of the Quill & Cup writing community: covers, titles, authors and where to get each one.";
/** The line under the heading. */
export const PUBLIC_BOOKSHELF_INTRO = "Books written by our members. Tap a cover to see where to get it.";
export const PUBLIC_BOOKSHELF_EMPTY = "No books on the shelf yet. Check back soon.";
/** What the block loads (the block clamps to its own cap, 500, and tests/lib/public-bookshelf-routes.test.ts keeps the two equal) and how many cards show before Show more books. */
export const PUBLIC_BOOKSHELF_MAX_BOOKS = 500;
export const PUBLIC_BOOKSHELF_FIRST_SHOWN = 24;

/** The address of the public page, as search engines and link cards name it. */
export const publicBookshelfUrl = () => `${APP_URL}${BOOKSHELF_PATH}`;

/**
 * Where the proxy sends a signed-out visitor to the Bookshelf. Null for any other path. The page it lands on reads only books at
 * the globe and nothing about the member beyond the name on the book.
 */
export function publicBookshelfRewrite(pathname: string): string | null {
  return pathname === BOOKSHELF_PATH || pathname === `${BOOKSHELF_PATH}/` ? PUBLIC_BOOKSHELF_RENDER_PATH : null;
}

/**
 * The page as a landing page document: a heading and the Hedgie Bookshelf block, so the public page is drawn by the blocks the page
 * builder has and reads its books through the block's own loader (service role, paged past 1000 rows, cached a minute, dropped at
 * once when a member changes a book). Never stored; the site's published header and footer frame it like a website page.
 */
export function publicBookshelfDocument() {
  return {
    root: {},
    content: [
      {
        type: "Hero",
        props: {
          id: "public-bookshelf-heading",
          headline: PUBLIC_BOOKSHELF_TITLE,
          level: "h1",
          subhead: PUBLIC_BOOKSHELF_INTRO,
          primary: { label: "", href: "" },
          secondary: { label: "", href: "" },
          alt: "",
          decorative: false,
          imageMode: "background",
          overlay: "none",
          background: "plum",
          align: "center",
          padding: "medium",
        },
      },
      {
        type: "HedgieBookshelf",
        props: {
          id: "public-bookshelf-books",
          heading: "",
          intro: "",
          genre: "",
          max: PUBLIC_BOOKSHELF_MAX_BOOKS,
          firstShown: PUBLIC_BOOKSHELF_FIRST_SHOWN,
          emptyText: PUBLIC_BOOKSHELF_EMPTY,
          padding: "large",
        },
      },
    ],
  };
}
