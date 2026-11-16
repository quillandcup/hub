/**
 * Browser tab titles. The root layout's metadata uses these, and client code that changes the
 * title without a navigation (path-based tabs, components/Tabs.tsx) builds the same string.
 */
export const DEFAULT_TITLE = "Hedgie Hub";
export const TITLE_TEMPLATE = "%s | Hedgie Hub";

/** The site's description in link previews and search results (the root layout's metadata, and the Slack card for a link to the Hub's public pages). */
export const SITE_DESCRIPTION =
  "The Quill & Cup member hub: find prickles and events, track your writing streaks and projects, and connect with fellow writers.";

/** The titles of the public pages that have no data of their own, shared by the pages' metadata and the Slack card for a link to them (lib/link-unfurl/share-cards.ts). */
export const PUBLIC_PAGE_TITLES = { login: "Login", privacy: "Privacy" } as const;

/** The full document title for a page title, as Next renders `metadata.title` through the template. */
export function documentTitle(title: string): string {
  return TITLE_TEMPLATE.replace("%s", title);
}
