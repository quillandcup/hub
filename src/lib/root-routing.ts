import { APP_HOST, APP_URL, KAJABI_SITE_URL, ROOT_HOST, SITE_ALIAS_HOSTS, SITE_URL } from "@/lib/config";
import { ROOT_REDIRECTS, fillTarget, matchRedirect, type RootRedirect } from "@/lib/root-redirects";

/**
 * Which host a request is for decides what happens to it. The same deployment answers three kinds of host:
 *
 *   - the APP host (hub.quillandcup.com, `appUrl`), preview deployments and localhost: the Hub behaves as before (signed-out
 *     visitors go to /login, an unknown path is a normal 404), with one exception: a public page (PUBLIC_PAGE_SEGMENTS: /w and /p,
 *     writer profiles and landing pages with their sitemaps) has one address, on the root host, so on the app host (only that
 *     one: a preview or localhost still serves them, so they can be tried) it is a 307 to the same path and query there.
 *   - an ALIAS of the public site (www.quillandcup.com, `siteAliasHosts`): 307 to the same path and query on the root host.
 *   - the ROOT host (quillandcup.com, `siteUrl`): the public site. Decided in this order (decideRoute):
 *       1. An explicit entry in src/lib/root-redirects.ts, unless it would shadow a path the Hub serves or owns.
 *       2. "/" and the paths the Hub serves on the root host (ROOT_SERVED_SEGMENTS) and the platform's own
 *          (INFRASTRUCTURE_SEGMENTS: /api, /_next, /monitoring, /.well-known, robots, the service worker, ...): render here.
 *          No sign-in is needed or attempted: the session cookie belongs to the app host, so nobody is signed in on this host.
 *       3. A signed-in Hub path (HUB_ONLY_SEGMENTS: /dashboard, /admin, /auth, ...): 307 to the same path on the app host.
 *          Sending a visitor to /login here would sign them in on the wrong host.
 *       4. Anything else is an old Kajabi address (a checkout link in an email, an Instagram link, a bookmark): 307 to the
 *          same path and query on the Kajabi host, so it keeps working.
 *
 * Why the proxy and a list of segments rather than a catch-all `[...path]` route: the proxy runs before routing and before the
 * sign-in redirect, so it is the one place that can stop an anonymous visitor on the root host being sent to /login, it
 * leaves the app host untouched (a catch-all would also have to produce the normal 404 page there), and it handles every method.
 * The price is that a new top-level page has to be named in one of the lists; tests/lib/root-routing-drift.test.ts fails when
 * src/app gains a top-level path that none of them accounts for, so a real page cannot silently turn into a redirect.
 * To take a page over from Kajabi, add the segment to ROOT_SERVED_SEGMENTS (and build the page): it then wins over the fallback.
 *
 * Every redirect is 307 (temporary: the pages are taken over gradually, so no browser or search engine may remember one) and
 * keeps the method, the path (case, percent-encoding and trailing slash exactly as sent) and the whole query string.
 */

/**
 * The public pages that live on one address, the root host's: the app host sends them there (decideRoute). All are in
 * ROOT_SERVED_SEGMENTS (tests/lib/root-routing.test.ts). /privacy, /security and /compliance are not here: members read them inside the Hub too.
 */
export const PUBLIC_PAGE_SEGMENTS: readonly string[] = ["w", "p"];

/** Top-level paths the Hub serves on the root host, signed out. "/" (the homepage) is always served. */
export const ROOT_SERVED_SEGMENTS: readonly string[] = ["w", "p", "privacy", "security", "compliance"];

/**
 * Top-level paths that are the platform's or a file's, not a page: served as they are on every host (never sent to Kajabi).
 * `api` includes every webhook (/api/webhooks/...). The others are Next internals, the Sentry tunnel (/monitoring), the Web Push
 * service worker, the web app manifest, robots and sitemaps, well-known files, and the files in public/ that the proxy's
 * matcher does not already skip.
 */
export const INFRASTRUCTURE_SEGMENTS: readonly string[] = [
  "api",
  "_next",
  "_vercel",
  "monitoring",
  ".well-known",
  "favicon.ico",
  "sw.js",
  "manifest.webmanifest",
  "robots.txt",
  "sitemap.xml",
  "player-spike-captions.vtt",
  "player-spike-captions-es.vtt",
];

/** Top-level signed-in (or token-link) paths of the Hub: on the root host they go to the same path on the app host. */
export const HUB_ONLY_SEGMENTS: readonly string[] = [
  // (member) route group
  "big-sisters", "bookshelf", "changelog", "chat", "courses", "dashboard", "events", "help", "members",
  "my-prickles", "notifications", "prickles", "projects", "search", "settings", "streaks", "wheel-of-wonder",
  "writer-profile",
  // (admin) route group
  "admin",
  // outside both groups
  "auth", "course-preview", "lesson-preview", "login", "mfa", "no-access", "unsubscribe", "verify-email",
];

export interface RouteRequest {
  host: string;
  method: string;
  /** The path as sent (percent-encoded, case and trailing slash kept). */
  pathname: string;
  /** The query string with its leading "?", or "". */
  search: string;
}

/** `pass` carries which kind of host it is: on the root host nobody is signed in (see the top of this file). */
export type RouteDecision = { action: "pass"; host: "app" | "root" } | { action: "redirect"; location: string; status: 307 | 308 };

export interface RoutingConfig {
  rootHost: string;
  appHost: string;
  aliasHosts: readonly string[];
  siteUrl: string;
  appUrl: string;
  kajabiUrl: string;
  redirects: readonly RootRedirect[];
  rootServed: readonly string[];
  infrastructure: readonly string[];
  hubOnly: readonly string[];
  publicPages: readonly string[];
}

export const DEFAULT_ROUTING: RoutingConfig = {
  rootHost: ROOT_HOST,
  appHost: APP_HOST,
  aliasHosts: SITE_ALIAS_HOSTS,
  siteUrl: SITE_URL,
  appUrl: APP_URL,
  kajabiUrl: KAJABI_SITE_URL,
  redirects: ROOT_REDIRECTS,
  rootServed: ROOT_SERVED_SEGMENTS,
  infrastructure: INFRASTRUCTURE_SEGMENTS,
  hubOnly: HUB_ONLY_SEGMENTS,
  publicPages: PUBLIC_PAGE_SEGMENTS,
};

/** The host as a header carries it: lowercase, no port, no trailing dot. */
export function normalizeHost(host: string | null | undefined): string {
  return (host ?? "").trim().toLowerCase().replace(/:\d+$/, "").replace(/\.$/, "");
}

/** The first path segment ("" for "/"). Percent-encoding is left alone, so "%64ashboard" is not "dashboard" and goes to Kajabi. */
export function firstSegment(pathname: string): string {
  return pathname.split("/")[1] ?? "";
}

/**
 * `base`'s origin followed by the path and query exactly as sent. The path is appended to the origin as text and the result is
 * checked, so a path such as "//evil.example" or "/\evil.example" can never change the host (it stays a path on `base`):
 * `new URL("//evil.example", base)` would have. Not reached for a host other than `base`'s: the fallback is the origin's front page.
 */
export function sameLocation(base: string, pathname: string, search: string): string {
  const origin = new URL(base).origin;
  const path = pathname.startsWith("/") ? pathname : `/${pathname}`;
  try {
    const url = new URL(`${origin}${path}${search}`);
    if (url.origin === origin) return url.href;
  } catch {
    // fall through to the front page
  }
  return `${origin}/`;
}

function explicitTarget(entry: RootRedirect, rest: string, req: RouteRequest, config: RoutingConfig): string {
  const to = fillTarget(entry.to, rest);
  const [toPath, toQuery = ""] = to.split("?");
  const search = [toQuery, req.search.replace(/^\?/, "")].filter(Boolean).join("&");
  const withQuery = search ? `?${search}` : "";
  if (/^https?:\/\//i.test(toPath)) {
    const url = new URL(toPath);
    return sameLocation(url.origin, `${url.pathname}`, withQuery);
  }
  return sameLocation(config.appUrl, toPath, withQuery);
}

/** Only "/" is the homepage: a path like "//host" has an empty first segment but is not it. */
function isHome(pathname: string): boolean {
  return pathname === "/" || pathname === "";
}

function ownedByHub(pathname: string, segment: string, config: RoutingConfig): boolean {
  return isHome(pathname) || config.rootServed.includes(segment) || config.infrastructure.includes(segment) || config.hubOnly.includes(segment);
}

/** What to do with a request, by host and path. See the top of this file. */
export function decideRoute(req: RouteRequest, config: RoutingConfig = DEFAULT_ROUTING): RouteDecision {
  const host = normalizeHost(req.host);

  if (config.aliasHosts.includes(host)) {
    return { action: "redirect", location: sameLocation(config.siteUrl, req.pathname, req.search), status: 307 };
  }
  if (host === config.appHost && config.publicPages.includes(firstSegment(req.pathname))) {
    return { action: "redirect", location: sameLocation(config.siteUrl, req.pathname, req.search), status: 307 };
  }
  if (host !== config.rootHost) return { action: "pass", host: "app" };

  const segment = firstSegment(req.pathname);
  const owned = ownedByHub(req.pathname, segment, config);

  for (const entry of config.redirects) {
    if (owned && !entry.overridesHub) continue;
    const match = matchRedirect(entry.from, req.pathname);
    if (!match) continue;
    return { action: "redirect", location: explicitTarget(entry, match.rest, req, config), status: entry.permanent ? 308 : 307 };
  }

  if (isHome(req.pathname) || config.rootServed.includes(segment) || config.infrastructure.includes(segment)) return { action: "pass", host: "root" };
  if (config.hubOnly.includes(segment)) {
    return { action: "redirect", location: sameLocation(config.appUrl, req.pathname, req.search), status: 307 };
  }
  return { action: "redirect", location: sameLocation(config.kajabiUrl, req.pathname, req.search), status: 307 };
}

/** True when this request is for the root host (the public site), where the homepage renders instead of the dashboard redirect. */
export function isRootHost(host: string | null | undefined, config: RoutingConfig = DEFAULT_ROUTING): boolean {
  return normalizeHost(host) === config.rootHost;
}
