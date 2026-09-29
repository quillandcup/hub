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
