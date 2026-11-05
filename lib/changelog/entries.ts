/**
 * The Hedgie Hub changelog: one entry per release a member would notice, newest first or not (the
 * helpers sort). This file is the single source: the in-app pages (/changelog), the generated
 * CHANGELOG.md (`pnpm changelog:generate`, checked by a test) and the "What's new" digest all read it.
 * Written for members: say what they can now do, not what changed in the code. See docs/CHANGELOG_PROCESS.md.
 *
 * Screenshots live in public/changelog/<slug>/ (the repo and that folder are public: no member data in
 * them) and are written in `body` as `![alt](/changelog/<slug>/<file>.png)`. `image` is the one shown on
 * the list, the digest and the Slack post.
 */

export const CHANGELOG_CATEGORIES = {
  new: "New",
  improved: "Improved",
  fixed: "Fixed",
} as const;

export type ChangelogCategory = keyof typeof CHANGELOG_CATEGORIES;

/**
 * Who an entry is for. `product` entries are what members see: the What's new pages, the weekly digest, the
 * announcements post, and CHANGELOG.md. `engineering` entries (platform improvements, or the lower-level detail behind
 * a product update) appear only in CHANGELOG.md, with their body, and have no page or notification.
 */
export const CHANGELOG_AUDIENCES = {
  product: "Product",
  engineering: "Engineering",
} as const;

export type ChangelogAudience = keyof typeof CHANGELOG_AUDIENCES;

export interface ChangelogEntry {
  /** The permalink (`/changelog/<slug>`): lowercase words and hyphens. Never changed once published, so shared links keep working. */
  slug: string;
  /** The day it shipped, YYYY-MM-DD (Eastern). */
  date: string;
  audience: ChangelogAudience;
  category: ChangelogCategory;
  title: string;
  /** One or two plain sentences (no markdown): the excerpt in the list, the digest and the Slack post. */
  summary: string;
  /** The full write-up in markdown: images as `/changelog/<slug>/<file>`, links to Hub pages as `/path`. */
  body: string;
  /** A screenshot shown with the summary: a path under /changelog/<slug>/. */
  image?: { src: string; alt: string };
}

export const CHANGELOG_ENTRIES: readonly ChangelogEntry[] = [
  {
    slug: "whats-new-changelog",
    date: "2026-11-04",
    audience: "product",
    category: "new",
    title: "A changelog for the Hedgie Hub",
    summary:
      "See what's new and fixed in the Hub, right here in the Hub. Choose how you hear about updates in Settings → Notifications.",
    body: [
      "Every improvement and fix you might notice now gets a short write-up here, newest first, with screenshots where they help.",
      "![The What's new page in the Hub](/changelog/whats-new-changelog/01-whats-new-list.webp)",
      "You can find it any time under the **?** menu in the top bar.",
    ].join("\n\n"),
    image: { src: "/changelog/whats-new-changelog/01-whats-new-list.webp", alt: "The What's new page in the Hub, listing the latest update" },
  },
];
