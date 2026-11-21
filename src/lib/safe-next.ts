import { toSafeRelativePath } from "@/lib/sudo-redirect";

/**
 * "Where to go after signing in", without an open redirect.
 *
 * When the proxy bounces a signed-out visitor to /login it remembers the page they asked for in
 * the NEXT_PATH_COOKIE cookie (httpOnly, short-lived), and every sign-in path -- the email
 * magic-link callback, the Slack button, the Slack code -- sends them back there. Anything that
 * reads a destination, from that cookie or a `next` query param, must pass it through
 * safeNextPath(). See "Site-wide return-to handling" in docs/TODO.md for unifying this with the
 * sudo return path and "Back to …" links.
 */

export const NEXT_PATH_COOKIE = "hub_next";
export const NEXT_PATH_COOKIE_MAX_AGE_SECONDS = 60 * 60;

/**
 * A same-origin path (pathname + search + hash) or null. Stricter than toSafeRelativePath: only
 * relative paths are accepted (a full URL is rejected, not reduced to its path), plus no control
 * characters or backslashes, and never the sign-in pages themselves (so a bad value can't loop).
 */
export function safeNextPath(raw: string | null | undefined): string | null {
  if (!raw || raw.length > 2048 || !raw.startsWith("/")) return null;
  if (raw.includes("\\") || /[\u0000-\u001f\u007f]/.test(raw)) return null;

  const path = toSafeRelativePath(raw);
  if (!path) return null;
  const pathname = path.split(/[?#]/, 1)[0];
  if (pathname === "/login" || pathname.startsWith("/auth/")) return null;
  return path;
}

/**
 * Whether a signed-out request is worth remembering as "where they were headed" (the proxy's `hub_next` cookie). Only a plain page
 * navigation is, as in Devise (Rails): a GET the browser made to show a page, not a form post or server action, not Next's RSC
 * fetches and prefetches (either prefetch header), not any other background `fetch`, and not the bare root `/`, which says nothing
 * (it is where sign-in goes anyway). The cookie is one slot per browser and the last write wins, so a background request from another
 * open tab, a tab signed out a moment ago, would otherwise overwrite the page the visitor actually clicked a link to. Headers a browser
 * doesn't send (old browsers, tests) don't count against a request.
 */
export function isRememberableVisit(method: string, headers: { get(name: string): string | null }, path: string): boolean {
  if (method !== "GET") return false;
  if (path.split(/[?#]/, 1)[0] === "/") return false;
  if (headers.get("rsc") || headers.get("next-router-prefetch") || headers.get("next-router-segment-prefetch")) return false;
  const mode = headers.get("sec-fetch-mode");
  if (mode && mode !== "navigate") return false;
  const dest = headers.get("sec-fetch-dest");
  if (dest && dest !== "document") return false;
  return true;
}
