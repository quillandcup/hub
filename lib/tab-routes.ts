import { redirect } from "next/navigation";

/**
 * Path-based tabs. A tabbed page's first tab lives at its base path and every other tab at
 * `<basePath>/<id>` (e.g. /my-prickles, /my-prickles/all). Each non-first tab is a small route
 * folder whose page.tsx renders the page's shared component with that tab, so a direct load or
 * reload opens the right tab. Once loaded, `<Tabs basePath>` (components/Tabs.tsx) switches tabs
 * on the client and rewrites the path with history.replaceState: instant, no server round trip.
 */

/** The URL of tab `id` on a page whose first tab is `defaultId`. */
export function tabHref(basePath: string, id: string, defaultId: string): string {
  return id === defaultId ? basePath : `${basePath}/${id}`;
}

/**
 * What a tabbed page's title is made of: the record it shows, if any (a member's name), and the
 * section it belongs to (e.g. "My Prickles"). At least one.
 */
export type TabPageTitle = { record: string; section?: string } | { record?: string; section: string };

/**
 * A tab's page title (before the site template), always most specific first since browsers cut
 * titles off on the right: record · tab · section. So "All Prickles · My Prickles", "Fern Quillsby
 * · Slack Activity". The first tab adds no tab name ("My Prickles", "Fern Quillsby"). Route
 * metadata and `<Tabs pageTitle>` both use it, so a direct load and a client-side tab switch show
 * the same browser tab title.
 */
export function tabTitle(page: TabPageTitle, tabLabel: string, isFirstTab: boolean): string {
  return [page.record, isFirstTab ? undefined : tabLabel, page.section].filter(Boolean).join(" · ");
}

type SearchParams = Record<string, string | string[] | undefined>;

/**
 * Keeps links from before path-based tabs working: `<basePath>?tab=<id>&...` redirects to that
 * tab's path, keeping the other params. Call from the base path's page. A missing or unknown
 * `tab` is a no-op (the first tab renders).
 */
export function redirectLegacyTabParam(
  basePath: string,
  tabIds: readonly string[],
  searchParams: SearchParams,
  /** Rewrites the target before redirecting (e.g. a legacy param that now lives on another tab). */
  rewrite?: (target: { tab: string; params: URLSearchParams }) => void
): void {
  const raw = searchParams.tab;
  const tab = Array.isArray(raw) ? raw[0] : raw;
  if (!tab || !tabIds.includes(tab)) return;

  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(searchParams)) {
    if (key === "tab" || value === undefined) continue;
    for (const v of Array.isArray(value) ? value : [value]) params.append(key, v);
  }
  const target = { tab, params };
  rewrite?.(target);
  const query = target.params.toString();
  // Counted in the Vercel logs to decide when these redirects can go (docs/TODO.md).
  console.info("[legacy-tab-redirect]", { basePath, tab });
  redirect(`${tabHref(basePath, target.tab, tabIds[0])}${query ? `?${query}` : ""}`);
}
