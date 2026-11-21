/**
 * Who Google Analytics thinks the visitor is. Client-safe.
 *
 * Two IDs are in play:
 * - GA's anonymous browser ID, kept in the `_ga` cookie. It's there before
 *   sign-in and survives sign-out, and GA4's BigQuery export calls it
 *   `user_pseudo_id`. Only set once analytics consent is granted.
 * - Our `user_id`: the signed-in person's auth user ID (not members.id, which a
 *   member merge can delete; this also covers staff). Sent to GA while signed
 *   in, cleared at sign-out, per Google's User-ID guide.
 *
 * The proxy and page-view tracker also store the browser ID on each
 * access_events row, so we hold the link between the two ourselves: visits a
 * browser made before signing in (or after signing out) can be attributed to
 * the member it belongs to, whatever GA's own reports do with them.
 */

/** GA4's first-party cookie holding the browser ID. */
export const GA_COOKIE_NAME = "_ga";

/**
 * The browser ID from a `_ga` cookie value: "GA1.1.1234567890.1700000000"
 * gives "1234567890.1700000000", the same value GA exports as user_pseudo_id.
 * Null when the cookie is missing or doesn't look like one of GA's.
 */
export function gaClientIdFromCookie(value: string | null | undefined): string | null {
  const match = value?.match(/^GA\d+\.\d+\.(\d{1,20}\.\d{1,20})$/);
  return match ? match[1] : null;
}

/** Tells GA who is signed in, or null at sign-out, for every event after this call. */
export function setAnalyticsUserId(userId: string | null): void {
  window.gtag?.("set", { user_id: userId });
}

/**
 * The gtag command for the first page load's inline script, so the initial
 * page_view already carries the user. Empty for anonymous visitors: Google says
 * not to send user_id for someone who hasn't signed in.
 */
export function initialUserIdCommand(userId: string | null): string {
  return userId ? `gtag('set', ${JSON.stringify({ user_id: userId })});` : "";
}
