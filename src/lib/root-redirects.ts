/**
 * Explicit redirects for the public site's root host (quillandcup.com), checked by src/lib/root-routing.ts before the
 * "send everything else to Kajabi" fallback.
 *
 * HOW TO ADD ONE
 *   Add an entry to ROOT_REDIRECTS: `{ from: "/old-page", to: "/new-page" }`.
 *   - `from` is a path on the root host: an exact path ("/old-page"), or a prefix with a rest-of-path marker
 *     ("/old/:rest*" matches "/old", "/old/a" and "/old/a/b"; `:rest*` in `to` is replaced by what it matched).
 *   - `to` is an absolute URL ("https://...") or a path on the Hub app host (the signed-in site, `appUrl`).
 *   - The request's query string (UTM tags, coupon codes) is always carried over. A query in `to` goes first.
 *   - Temporary (307) unless `permanent: true` (308). Use permanent only for an address that will never come back: browsers
 *     and search engines remember it for a long time and it is hard to undo.
 *   - First match wins, so put the specific entry before the general one.
 *
 * PRECEDENCE (src/lib/root-routing.ts)
 *   An explicit entry beats the Kajabi fallback. It does NOT beat a path the Hub itself serves or owns (a page on the
 *   root host such as /privacy or /w/..., or a signed-in route such as /dashboard): such an entry is ignored, so a new Hub
 *   page can never be shadowed by an old entry. An entry that must override one on purpose says `overridesHub: true`
 *   (the `/login` entry does: the Hub's own login lives on the app host, so the root address sends people there).
 *   Entries only apply on the root host; the app host and previews never see them.
 */
export interface RootRedirect {
  from: string;
  to: string;
  /** 308 instead of 307. Default false. */
  permanent?: boolean;
  /** Apply even though the first segment of `from` is a path the Hub serves or owns. Default false. */
  overridesHub?: boolean;
}

export const ROOT_REDIRECTS: readonly RootRedirect[] = [
  // Members sign in on the Hub, so the old Kajabi login address goes to the Hub login (the Hub login page links back to Kajabi login for those who still need it).
  { from: "/login", to: "/login", overridesHub: true },
];

const REST = /\/:([A-Za-z_]\w*)\*$/;

/** The part of `pathname` an entry's `from` matches, or null when it does not match. `rest` is "" for an exact match. */
export function matchRedirect(from: string, pathname: string): { rest: string } | null {
  const m = REST.exec(from);
  if (!m) return from === pathname ? { rest: "" } : null;
  const prefix = from.slice(0, m.index);
  if (pathname === prefix) return { rest: "" };
  if (pathname.startsWith(`${prefix}/`)) return { rest: pathname.slice(prefix.length + 1) };
  return null;
}

/** Fills the rest-of-path marker in `to` with what `from` matched. */
export function fillTarget(to: string, rest: string): string {
  return to.replace(/\/:([A-Za-z_]\w*)\*/, rest ? `/${rest}` : "");
}
