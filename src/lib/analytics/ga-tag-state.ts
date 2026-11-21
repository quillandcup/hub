/**
 * Whether the Google Analytics tag was running in the browser when a page view was reported, so a member
 * with no `_ga` cookie can be told apart: tag blocked, or tag running but no cookie. Client-safe.
 *
 * Read from the page's own state, never from the network or the device: no request, no new third-party call.
 * - `tag_running`: gtag.js ran and registered this property (`window.google_tag_manager[<id>]`).
 * - `not_applicable`: no GA id is configured, or analytics is denied (the EU default before a choice, a declined
 *   banner, or "leave me out of statistics"). The tag still loads then but sets no cookie, so a missing cookie
 *   says nothing about blocking.
 * - `not_loaded`: analytics is allowed and the tag has not run. Only reported after a bounded wait
 *   (`watchGaTag`), because gtag.js loads after the page is interactive.
 *
 * Why not the resource-timing entry of gtag.js: a blocked request leaves no entry, a request that succeeded but
 * did not run (a blocked response, a script error) looks fine, and the status is hidden cross-origin. Whether the
 * tag ran is the question, and `google_tag_manager` answers it directly.
 */

export const GA_TAG_STATES = ["tag_running", "not_loaded", "not_applicable"] as const;
export type GaTagState = (typeof GA_TAG_STATES)[number];

/** A value from an untrusted body: the state if it is one of ours, else null. */
export function parseGaTagState(value: unknown): GaTagState | null {
  return typeof value === "string" && (GA_TAG_STATES as readonly string[]).includes(value) ? (value as GaTagState) : null;
}

/** The slice of `window` this reads, so tests can pass a plain object. */
export interface GaTagWindow {
  google_tag_manager?: Record<string, unknown>;
  dataLayer?: unknown[];
}

/**
 * The analytics consent as gtag.js will apply it: the last `consent` command (default, then the banner's or the
 * opt-out's update) in the data layer. Undefined when none was sent.
 */
function analyticsStorage(win: GaTagWindow): string | undefined {
  let state: string | undefined;
  for (const entry of win.dataLayer ?? []) {
    if (entry == null || typeof entry !== "object") continue;
    const [command, action, values] = Array.from(entry as ArrayLike<unknown>);
    if (command !== "consent" || (action !== "default" && action !== "update")) continue;
    const next = (values as { analytics_storage?: unknown } | undefined)?.analytics_storage;
    if (typeof next === "string") state = next;
  }
  return state;
}

/** The state right now. `not_loaded` here may only mean "not yet"; `watchGaTag` waits before reporting it. */
export function readGaTagState(win: GaTagWindow, gaId: string | undefined): GaTagState {
  if (!gaId) return "not_applicable";
  if (analyticsStorage(win) === "denied") return "not_applicable";
  return win.google_tag_manager?.[gaId] ? "tag_running" : "not_loaded";
}

export interface WatchOptions {
  /** How long to keep waiting after the page finished loading. */
  graceMs?: number;
  /** The longest to wait in total, for a page that never finishes loading. */
  maxMs?: number;
  intervalMs?: number;
}

export interface GaTagWatch {
  /** Reports the state as it is now, if not reported yet (for a page being left). */
  settleNow(): void;
}

/**
 * Reports the tag state once. Settles at once when the tag is running or not applicable; otherwise polls until it
 * runs, or until `graceMs` after the page finished loading (`maxMs` at the most), then reports `not_loaded`. So a
 * slow tag is not counted as blocked. `onSettled` is called exactly once.
 */
export function watchGaTag(
  win: GaTagWindow & { document?: Pick<Document, "readyState"> },
  gaId: string | undefined,
  onSettled: (state: GaTagState) => void,
  { graceMs = 2000, maxMs = 8000, intervalMs = 250 }: WatchOptions = {},
): GaTagWatch {
  let done = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const settle = () => {
    if (done) return;
    done = true;
    if (timer) clearTimeout(timer);
    onSettled(readGaTagState(win, gaId));
  };

  if (readGaTagState(win, gaId) !== "not_loaded") {
    settle();
    return { settleNow: settle };
  }

  const started = Date.now();
  let loadedAt: number | null = null;
  const tick = () => {
    if (done) return;
    const now = Date.now();
    if (readGaTagState(win, gaId) !== "not_loaded") return settle();
    if (win.document?.readyState === "complete") loadedAt ??= now;
    if (now - started >= maxMs || (loadedAt !== null && now - loadedAt >= graceMs)) return settle();
    timer = setTimeout(tick, intervalMs);
  };
  timer = setTimeout(tick, intervalMs);
  return { settleNow: settle };
}
