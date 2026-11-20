import { describe, expect, it } from "vitest";
import { CSP_HEALTH } from "@/lib/config";
import {
  browserLabel,
  checkLostGoogleCookie,
  checkStrandedUsers,
  checkUnsupportedBrowsers,
  cspHealthProblems,
  evaluateCspHealth,
  isToolingUserAgent,
  isUnsupportedBrowser,
  summarizeUsers,
  versionBelow,
  type UserActivity,
} from "@/lib/csp-health";
import type { AccessActivityRow } from "@/lib/data/access-events";

const CHROME = (v: string) => `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${v}.0.0.0 Safari/537.36`;
const EDGE = (v: string) => `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${v}.0.0.0 Safari/537.36 Edg/${v}.0.0.0`;
const FIREFOX = (v: string) => `Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:${v}.0) Gecko/20100101 Firefox/${v}.0`;
const IOS_SAFARI = (os: string) => `Mozilla/5.0 (iPhone; CPU iPhone OS ${os} like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/${os.replace("_", ".")} Mobile/15E148 Safari/604.1`;
const IOS_CHROME = (os: string) => `Mozilla/5.0 (iPhone; CPU iPhone OS ${os} like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/150.0.0.0 Mobile/15E148 Safari/604.1`;
const MAC_SAFARI = (v: string) => `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/${v} Safari/605.1.15`;

const user = (n: number, over: Partial<UserActivity> = {}): UserActivity => ({
  userId: `u${n}`,
  requests: 10,
  scriptRequests: 0,
  pageViews: 5,
  pageViewsWithGa: 5,
  historyPageViewsWithGa: 20,
  browser: "Chrome 150",
  ...over,
});
const users = (count: number, over: Partial<UserActivity> = {}) => Array.from({ length: count }, (_, i) => user(i, over));
const row = (n: number, userAgent: string | null, over: Partial<AccessActivityRow> = {}): AccessActivityRow => ({
  userId: `u${n}`,
  userAgent,
  requests: 10,
  scriptRequests: 0,
  pageViews: 5,
  pageViewsWithGa: 5,
  historyPageViewsWithGa: 20,
  ...over,
});

describe("browserLabel", () => {
  it("names the family and major version, and the iOS version on an iPhone", () => {
    expect(browserLabel(CHROME("150"))).toBe("Chrome 150");
    expect(browserLabel(EDGE("155"))).toBe("Edge 155");
    expect(browserLabel(FIREFOX("153"))).toBe("Firefox 153");
    expect(browserLabel(IOS_SAFARI("18_5"))).toBe("Safari 18 (iOS 18.5)");
  });

  it("says unknown for nothing, and never carries the user agent", () => {
    expect(browserLabel(null)).toBe("Unknown browser");
    expect(browserLabel("")).toBe("Unknown browser");
    expect(browserLabel(CHROME("150"))).not.toContain("Mozilla");
  });
});

describe("isToolingUserAgent", () => {
  it("ignores node and headless Chrome, not members' browsers", () => {
    expect(isToolingUserAgent("node")).toBe(true);
    expect(isToolingUserAgent(" Node ")).toBe(true);
    expect(isToolingUserAgent(CHROME("150").replace("Chrome/", "HeadlessChrome/"))).toBe(true);
    expect(isToolingUserAgent(CHROME("150"))).toBe(false);
    expect(isToolingUserAgent(null)).toBe(false);
  });
});

describe("summarizeUsers", () => {
  it("adds a user's rows, keeps their history once and names the browser they used most", () => {
    const [u] = summarizeUsers([
      row(1, CHROME("150"), { requests: 2, scriptRequests: 1, pageViews: 1, pageViewsWithGa: 1, historyPageViewsWithGa: 7 }),
      row(1, IOS_SAFARI("18_5"), { requests: 20, scriptRequests: 4, pageViews: 9, pageViewsWithGa: 0, historyPageViewsWithGa: 7 }),
    ]);
    expect(u).toMatchObject({ userId: "u1", requests: 22, scriptRequests: 5, pageViews: 10, pageViewsWithGa: 1, historyPageViewsWithGa: 7, browser: "Safari 18 (iOS 18.5)" });
  });

  it("leaves out tooling, and a user with only tooling rows", () => {
    expect(summarizeUsers([row(1, "node"), row(2, CHROME("150").replace("Chrome/", "HeadlessChrome/")), row(3, CHROME("150"))]).map((u) => u.userId)).toEqual(["u3"]);
  });
});

describe("checkStrandedUsers (never ran our scripts)", () => {
  const stranded = (n: number) => users(n, { pageViews: 0, pageViewsWithGa: 0, browser: "Safari 14" });
  const cfg = CSP_HEALTH.strandedUsers;

  it("is quiet with no users, and with healthy users", () => {
    expect(checkStrandedUsers([], cfg)).toMatchObject({ tripped: false, users: 0, of: 0 });
    expect(checkStrandedUsers(users(91), cfg).tripped).toBe(false);
  });

  const healthy = (n: number) => users(n).map((u, i) => ({ ...u, userId: `h${i}` }));

  it("does not trip below the minimum users (1 of 30), trips at it (2 of 30)", () => {
    expect(checkStrandedUsers([...stranded(1), ...healthy(29)], cfg).tripped).toBe(false);
    const two = checkStrandedUsers([...stranded(2), ...healthy(28)], cfg);
    expect(two).toMatchObject({ tripped: true, users: 2, of: 30, browsers: { "Safari 14": 2 } });
  });

  it("needs the share of the active users when that is more than the minimum: 5% of 91 is 5, of 100 is 5", () => {
    expect(checkStrandedUsers([...stranded(2), ...healthy(89)], cfg).tripped).toBe(false);
    expect(checkStrandedUsers([...stranded(4), ...healthy(87)], cfg).tripped).toBe(false);
    expect(checkStrandedUsers([...stranded(5), ...healthy(86)], cfg).tripped).toBe(true);
    expect(checkStrandedUsers([...stranded(4), ...healthy(96)], cfg).tripped).toBe(false);
    expect(checkStrandedUsers([...stranded(5), ...healthy(95)], cfg).tripped).toBe(true);
  });

  it("does not count a stale tab: requests only scripts make (API calls, prefetch bursts) prove they ran", () => {
    const staleTab = users(5, { pageViews: 0, pageViewsWithGa: 0, scriptRequests: 3 }).map((u, i) => ({ ...u, userId: `s${i}` }));
    expect(checkStrandedUsers([...staleTab, ...healthy(25)], cfg)).toMatchObject({ tripped: false, users: 0, of: 30 });
  });

  it("does not count a user with page views, or one with no requests at all", () => {
    expect(checkStrandedUsers([user(1, { requests: 0, pageViews: 0 }), user(2, { requests: 0, pageViews: 0 })], cfg).tripped).toBe(false);
  });
});

describe("checkLostGoogleCookie (the Google tag stopped working)", () => {
  const cfg = CSP_HEALTH.lostGoogleCookie;
  const lost = (n: number, offset = 0) => Array.from({ length: n }, (_, i) => user(offset + i, { pageViewsWithGa: 0, browser: "Safari 18 (iOS 18.5)" }));
  const fine = (n: number, offset = 100) => Array.from({ length: n }, (_, i) => user(offset + i));

  it("is quiet with no users and with no history", () => {
    expect(checkLostGoogleCookie([], cfg)).toMatchObject({ tripped: false, users: 0, of: 0 });
    expect(checkLostGoogleCookie(users(10, { pageViewsWithGa: 0, historyPageViewsWithGa: 0 }), cfg).tripped).toBe(false);
  });

  it("never counts members who never had the cookie (the steady 13 of 91)", () => {
    const never = users(13, { pageViewsWithGa: 0, historyPageViewsWithGa: 0 }).map((u, i) => ({ ...u, userId: `n${i}` }));
    expect(checkLostGoogleCookie([...never, ...fine(78)], cfg).tripped).toBe(false);
  });

  it("does not trip below the minimum users (3 of 12), trips at it (4 of 16 is exactly 25%)", () => {
    expect(checkLostGoogleCookie([...lost(3), ...fine(9)], cfg)).toMatchObject({ tripped: false, users: 3, of: 12 });
    expect(checkLostGoogleCookie([...lost(4), ...fine(12)], cfg)).toMatchObject({ tripped: true, users: 4, of: 16, browsers: { "Safari 18 (iOS 18.5)": 4 } });
  });

  it("does not trip when enough users but under the share (4 of 17)", () => {
    expect(checkLostGoogleCookie([...lost(4), ...fine(13)], cfg).tripped).toBe(false);
  });

  it("ignores users with fewer than the minimum page views", () => {
    const quiet = Array.from({ length: 10 }, (_, i) => user(200 + i, { pageViews: 2, pageViewsWithGa: 0 }));
    expect(checkLostGoogleCookie([...quiet, ...fine(2)], cfg)).toMatchObject({ tripped: false, users: 0, of: 2 });
    expect(checkLostGoogleCookie([user(1, { pageViews: 3, pageViewsWithGa: 0 })], { ...cfg, minUsers: 1 } as unknown as typeof cfg).tripped).toBe(true);
  });
});

describe("versionBelow", () => {
  it.each([
    ["51.0.0.0", "52", true],
    ["52.0", "52", false],
    ["150.0.0.0", "52", false],
    ["15.3", "15.4", true],
    ["15.4", "15.4", false],
    ["15", "15.4", true],
    ["16.0", "15.4", false],
    [null, "52", false],
    ["abc", "52", false],
  ])("%s below %s is %s", (version, minimum, expected) => {
    expect(versionBelow(version, minimum)).toBe(expected);
  });
});

describe("isUnsupportedBrowser", () => {
  const mins = CSP_HEALTH.minBrowserVersions;

  it.each([
    ["Chrome 51", CHROME("51"), true],
    ["Chrome 52", CHROME("52"), false],
    ["Chrome 150", CHROME("150"), false],
    ["Edge 78", EDGE("78"), true],
    ["Edge 79", EDGE("79"), false],
    ["Firefox 51", FIREFOX("51"), true],
    ["Firefox 52", FIREFOX("52"), false],
    ["Firefox 153", FIREFOX("153"), false],
    ["desktop Safari 15.3", MAC_SAFARI("15.3"), true],
    ["desktop Safari 15.4", MAC_SAFARI("15.4"), false],
    ["desktop Safari 18", MAC_SAFARI("18.0"), false],
    ["Safari on iOS 15.3", IOS_SAFARI("15_3"), true],
    ["Safari on iOS 15.4", IOS_SAFARI("15_4"), false],
    ["Safari on iOS 18.5", IOS_SAFARI("18_5"), false],
    ["Chrome on iOS 14.8 (the iOS version decides)", IOS_CHROME("14_8"), true],
    ["Chrome 150 on iOS 18.5", IOS_CHROME("18_5"), false],
  ])("%s -> %s", (_name, userAgent, expected) => {
    expect(isUnsupportedBrowser(userAgent, mins)).toBe(expected);
  });

  it("does not judge a missing or unreadable user agent", () => {
    expect(isUnsupportedBrowser(null, mins)).toBe(false);
    expect(isUnsupportedBrowser("curl/8.0", mins)).toBe(false);
  });
});

describe("checkUnsupportedBrowsers", () => {
  const mins = CSP_HEALTH.minBrowserVersions;

  it("is quiet for the browsers seen in production, and with no rows", () => {
    expect(checkUnsupportedBrowsers([], mins)).toMatchObject({ tripped: false, users: 0, of: 0 });
    const seen = [CHROME("150"), FIREFOX("153"), EDGE("155"), IOS_SAFARI("18_5"), MAC_SAFARI("18.0")];
    expect(checkUnsupportedBrowsers(seen.map((ua, i) => row(i, ua)), mins).tripped).toBe(false);
  });

  it("trips on one old browser, counting people not rows, and names it", () => {
    const rows = [row(1, CHROME("51")), row(1, CHROME("51"), { pageViews: 1 }), row(2, CHROME("51")), row(3, FIREFOX("153")), row(4, IOS_SAFARI("14_8"))];
    const result = checkUnsupportedBrowsers(rows, mins);
    expect(result).toMatchObject({ tripped: true, users: 3, of: 4 });
    expect(result.browsers).toEqual({ "Chrome 51": 2, "Safari 14 (iOS 14.8)": 1 });
  });

  it("ignores tooling and rows with no user agent", () => {
    expect(checkUnsupportedBrowsers([row(1, "node"), row(2, null), row(3, CHROME("51").replace("Chrome/", "HeadlessChrome/"))], mins).tripped).toBe(false);
  });
});

describe("evaluateCspHealth and cspHealthProblems", () => {
  it("is quiet when all is well", () => {
    const health = evaluateCspHealth([row(1, CHROME("150")), row(2, IOS_SAFARI("18_5"))], CSP_HEALTH);
    expect(health.stranded.tripped || health.lostGoogleCookie.tripped || health.unsupported.tripped).toBe(false);
    expect(cspHealthProblems(health, CSP_HEALTH)).toEqual([]);
  });

  it("says one line per failing check, with counts and browser names and nothing identifying", () => {
    const rows = [
      row(1, IOS_SAFARI("14_8"), { pageViews: 0, pageViewsWithGa: 0 }),
      row(2, IOS_SAFARI("14_8"), { pageViews: 0, pageViewsWithGa: 0 }),
      ...[3, 4, 5, 6].map((n) => row(n, CHROME("150"), { pageViewsWithGa: 0 })),
    ];
    const lines = cspHealthProblems(evaluateCspHealth(rows, CSP_HEALTH), CSP_HEALTH);
    expect(lines).toHaveLength(3);
    expect(lines[0]).toContain("2 of 6 active members");
    expect(lines[0]).toContain("Safari 14 (iOS 14.8) (2)");
    expect(lines[1]).toContain("4 of 4 members");
    expect(lines[1]).toContain(`last ${CSP_HEALTH.windowHours} hours`);
    expect(lines[2]).toContain("Safari 14 (iOS 14.8) (2)");
    const text = lines.join("\n");
    expect(text).not.toMatch(/u\d|Mozilla|@/);
  });
});
