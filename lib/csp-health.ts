// The daily health check for the nonce-based Content-Security-Policy (app/api/internal/csp-health, docs/CSP_ALERTS.md).
// A strict policy can fail quietly: a browser that ignores nonces never runs our scripts, and one that ignores
// 'strict-dynamic' blocks the Google tag the page injects. Three checks over the access log say so within a day.
// Everything here is pure: the route loads the activity rows and sends the result to Sentry, so the checks are
// unit-tested at their thresholds. Output is counts and browser names only (the repo is public).

import type { AccessActivityRow } from "@/lib/data/access-events";
import { parseDevice } from "@/lib/device";
import type { CSP_HEALTH } from "@/lib/config";

export type CspHealthConfig = typeof CSP_HEALTH;

/** User agents that are tooling, not members' browsers: the test suite's fetch and headless Chrome. */
export function isToolingUserAgent(userAgent: string | null): boolean {
  const ua = userAgent?.trim() ?? "";
  return ua.toLowerCase() === "node" || ua.includes("HeadlessChrome");
}

/** One signed-in user's activity in the window, over all their (non-tooling) browsers. */
export interface UserActivity {
  userId: string;
  /** Proxy-recorded requests (is_page = false): the server saw the user load something. */
  requests: number;
  /** Of those, the ones only running scripts make (API calls, router prefetch bursts): proof our JS ran. */
  scriptRequests: number;
  /** Beacon page views (is_page = true): our script ran in their browser. */
  pageViews: number;
  /** Of those page views, the ones that carried the `_ga` cookie. */
  pageViewsWithGa: number;
  /** Page views that carried `_ga` in the history window before this one. */
  historyPageViewsWithGa: number;
  /** The browser they used most, as "Chrome 150" or "Safari 18 (iOS 18)". */
  browser: string;
}

/** A browser as the alert names it: family and major version, plus the iOS version on an iPhone or iPad. Safe to post. */
export function browserLabel(userAgent: string | null): string {
  const device = parseDevice(userAgent);
  if (!device?.browser) return "Unknown browser";
  const clean = (s: string) => s.replace(/[^A-Za-z0-9 .]/g, "").trim();
  const major = device.browser_version?.split(".")[0] ?? "";
  const base = clean(`${device.browser} ${/^\d+$/.test(major) ? major : ""}`);
  const ios = device.os === "iOS" && device.os_version ? ` (iOS ${clean(device.os_version.split(".").slice(0, 2).join("."))})` : "";
  return `${base}${ios}`;
}

/** The activity rows grouped by user, tooling user agents left out. A user with only tooling rows is not a user. */
export function summarizeUsers(rows: AccessActivityRow[]): UserActivity[] {
  const byUser = new Map<string, UserActivity & { top: number }>();
  for (const row of rows) {
    if (isToolingUserAgent(row.userAgent)) continue;
    const weight = row.requests + row.pageViews;
    const user = byUser.get(row.userId) ?? {
      userId: row.userId,
      requests: 0,
      scriptRequests: 0,
      pageViews: 0,
      pageViewsWithGa: 0,
      historyPageViewsWithGa: 0,
      browser: browserLabel(row.userAgent),
      top: -1,
    };
    user.requests += row.requests;
    user.scriptRequests += row.scriptRequests;
    user.pageViews += row.pageViews;
    user.pageViewsWithGa += row.pageViewsWithGa;
    // The history is per user, repeated on each of their user-agent rows.
    user.historyPageViewsWithGa = Math.max(user.historyPageViewsWithGa, row.historyPageViewsWithGa);
    if (weight > user.top) {
      user.top = weight;
      user.browser = browserLabel(row.userAgent);
    }
    byUser.set(row.userId, user);
  }
  return [...byUser.values()].map((u) => ({
    userId: u.userId,
    requests: u.requests,
    scriptRequests: u.scriptRequests,
    pageViews: u.pageViews,
    pageViewsWithGa: u.pageViewsWithGa,
    historyPageViewsWithGa: u.historyPageViewsWithGa,
    browser: u.browser,
  }));
}

export interface CheckResult {
  tripped: boolean;
  /** Users in the state the check looks for. */
  users: number;
  /** The users the count is measured against. */
  of: number;
  /** How many of those users per browser, e.g. { "Chrome 150": 2 }. */
  browsers: Record<string, number>;
}

function tally(labels: string[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const label of labels) counts[label] = (counts[label] ?? 0) + 1;
  return counts;
}

/**
 * 1. Users who load pages but never run our scripts: requests recorded by the server, no beacon page view, and nothing
 * that only running scripts do (`scriptRequests`). Without that last condition a tab left open for days counts: it
 * keeps prefetching and polling with no new page view (3 of 18 users on 2026-11-20, 11 days of the last 14 would have
 * alerted). Alerts at `minUsers`, or `minShare` of the active users when that is more.
 */
export function checkStrandedUsers(users: UserActivity[], config: CspHealthConfig["strandedUsers"]): CheckResult {
  const stranded = users.filter((u) => u.requests > 0 && u.pageViews === 0 && u.scriptRequests === 0);
  const threshold = Math.max(config.minUsers, Math.ceil(config.minShare * users.length));
  return { tripped: stranded.length >= threshold, users: stranded.length, of: users.length, browsers: tally(stranded.map((u) => u.browser)) };
}

/**
 * 2. The Google tag stopped working: users active enough in the window (`minPageViews` page views) who had the `_ga`
 * cookie before, and have it on none of those page views. Each user is compared with their own history, because a
 * steady share of members never gets the cookie. Alerts at `minUsers` such users that are `minShare` of the users who
 * had it before.
 */
export function checkLostGoogleCookie(users: UserActivity[], config: CspHealthConfig["lostGoogleCookie"]): CheckResult {
  const tracked = users.filter((u) => u.pageViews >= config.minPageViews && u.historyPageViewsWithGa > 0);
  const lost = tracked.filter((u) => u.pageViewsWithGa === 0);
  const tripped = lost.length >= config.minUsers && lost.length / tracked.length >= config.minShare;
  return { tripped, users: lost.length, of: tracked.length, browsers: tally(lost.map((u) => u.browser)) };
}

/** "15.4" and "150.0.0.0" as numbers; null when there is no leading major. */
function majorMinor(version: string | null | undefined): [number, number] | null {
  const m = /^(\d+)(?:\.(\d+))?/.exec(version ?? "");
  return m ? [Number(m[1]), Number(m[2] ?? 0)] : null;
}

/** True when `version` is known and lower than `minimum` (major.minor). An unreadable version is not below anything. */
export function versionBelow(version: string | null | undefined, minimum: string): boolean {
  const have = majorMinor(version);
  const need = majorMinor(minimum);
  if (!have || !need) return false;
  return have[0] < need[0] || (have[0] === need[0] && have[1] < need[1]);
}

const MINIMUM_KEY: Record<string, keyof CspHealthConfig["minBrowserVersions"]> = {
  Chrome: "chrome",
  Chromium: "chromium",
  Edge: "edge",
  Firefox: "firefox",
  Safari: "safari",
};

/** Whether this user agent is a browser below what nonces plus 'strict-dynamic' need. Unknown browsers are not judged. */
export function isUnsupportedBrowser(userAgent: string | null, minimums: CspHealthConfig["minBrowserVersions"]): boolean {
  const device = parseDevice(userAgent);
  if (!device) return false;
  // Every browser on an iPhone or iPad is WebKit: the iOS version decides, not the browser's own number.
  if (device.os === "iOS") return versionBelow(device.os_version, minimums.ios);
  const key = device.browser ? MINIMUM_KEY[device.browser] : undefined;
  return key ? versionBelow(device.browser_version, minimums[key]) : false;
}

/** 3. Any request or page view from a browser below the minimum versions. `users` counts the people, not the requests. */
export function checkUnsupportedBrowsers(rows: AccessActivityRow[], minimums: CspHealthConfig["minBrowserVersions"]): CheckResult {
  const seen = new Set<string>();
  const labels: string[] = [];
  for (const row of rows) {
    if (isToolingUserAgent(row.userAgent) || !isUnsupportedBrowser(row.userAgent, minimums)) continue;
    const label = browserLabel(row.userAgent);
    if (seen.has(`${row.userId}|${label}`)) continue;
    seen.add(`${row.userId}|${label}`);
    labels.push(label);
  }
  const users = new Set([...seen].map((k) => k.split("|")[0])).size;
  const active = new Set(rows.filter((r) => !isToolingUserAgent(r.userAgent)).map((r) => r.userId)).size;
  return { tripped: labels.length > 0, users, of: active, browsers: tally(labels) };
}

export interface CspHealth {
  stranded: CheckResult;
  lostGoogleCookie: CheckResult;
  unsupported: CheckResult;
}

/** The three checks over the window's activity rows. */
export function evaluateCspHealth(rows: AccessActivityRow[], config: CspHealthConfig): CspHealth {
  const users = summarizeUsers(rows);
  return {
    stranded: checkStrandedUsers(users, config.strandedUsers),
    lostGoogleCookie: checkLostGoogleCookie(users, config.lostGoogleCookie),
    unsupported: checkUnsupportedBrowsers(rows, config.minBrowserVersions),
  };
}

/** The Sentry `logger` the health check's events carry; the alert rule in config/sentry.yml filters on it. */
export const CSP_HEALTH_LOGGER = "csp-health";

/** One Sentry event for a check that tripped. The message and fingerprint are fixed per check, so a condition that lasts is one issue. */
export interface CspHealthEvent {
  check: "stranded" | "lost-google-cookie" | "unsupported-browser";
  message: string;
  /** Counts and browser family and major version only: never member ids, names, emails or user agents. */
  extra: { users: number; of: number; windowHours: number; browsers: Record<string, number> };
}

const MESSAGES: Record<CspHealthEvent["check"], string> = {
  stranded: "CSP health: members load pages but never run our scripts",
  "lost-google-cookie": "CSP health: members lost the Google Analytics cookie they used to have",
  "unsupported-browser": "CSP health: a browser below the minimum for nonces and strict-dynamic is in use",
};

/** One event per check that tripped; empty when all is well. */
export function cspHealthEvents(health: CspHealth, config: CspHealthConfig): CspHealthEvent[] {
  const named: [CspHealthEvent["check"], CheckResult][] = [
    ["stranded", health.stranded],
    ["lost-google-cookie", health.lostGoogleCookie],
    ["unsupported-browser", health.unsupported],
  ];
  return named
    .filter(([, result]) => result.tripped)
    .map(([check, r]) => ({ check, message: MESSAGES[check], extra: { users: r.users, of: r.of, windowHours: config.windowHours, browsers: r.browsers } }));
}
