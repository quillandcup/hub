/**
 * Whether a request is a real top-level browser navigation: the member clicked a link and the browser is
 * loading the page. Browsers send `Sec-Fetch-Mode: navigate` and `Sec-Fetch-Dest: document` for that; link
 * checkers, mail scanners, prefetchers, unfurlers and scripts don't (and neither do browsers too old to send
 * the headers). Used by the routes where a GET spends a one-time credential (/auth/slack, /auth/confirm):
 * a navigation signs in directly, anything else gets a Continue page that spends it only on a click.
 */
export function isBrowserNavigation(headers: { get(name: string): string | null }): boolean {
  return headers.get("sec-fetch-mode") === "navigate" && headers.get("sec-fetch-dest") === "document";
}
