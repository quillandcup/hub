/**
 * Browser tab titles. The root layout's metadata uses these, and client code that changes the
 * title without a navigation (path-based tabs, components/Tabs.tsx) builds the same string.
 */
export const DEFAULT_TITLE = "Hedgie Hub";
export const TITLE_TEMPLATE = "%s | Hedgie Hub";

/** The full document title for a page title, as Next renders `metadata.title` through the template. */
export function documentTitle(title: string): string {
  return TITLE_TEMPLATE.replace("%s", title);
}
