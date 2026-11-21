import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { CSP_HEALTH } from "@/lib/config";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { createInMemoryRepos, type Repos } from "@/lib/data/repos";

// The daily CSP health route on the in-memory repositories, with auth, the alert post and the heartbeat faked.
const requireAdmin = vi.fn();
vi.mock("@/lib/supabase/api-auth", () => ({ requireAdmin: (r: unknown) => requireAdmin(r) }));
vi.mock("@/lib/supabase/service", () => ({ createServiceRoleClient: () => ({}) }));
const heartbeat = vi.fn();
vi.mock("@/lib/cron-heartbeats", () => ({
  withCronHeartbeat: async (job: string, res: Response) => {
    heartbeat(job);
    return res;
  },
}));
// Sentry is faked: each captureMessage is recorded with what its scope held, and flush is observed.
interface Captured {
  message: string;
  level: string | undefined;
  tags: Record<string, string>;
  fingerprint: string[];
  extra: Record<string, unknown>;
  logger: string | undefined;
}
const { captured, flush, order } = vi.hoisted(() => ({ captured: [] as Captured[], flush: vi.fn(async (_ms?: number) => true), order: [] as string[] }));
vi.mock("@sentry/nextjs", () => {
  interface Scope {
    level?: string;
    tags: Record<string, string>;
    fingerprint: string[];
    extra: Record<string, unknown>;
    processors: ((e: Record<string, unknown>) => Record<string, unknown>)[];
  }
  let current: Scope | null = null;
  return {
    withScope: (cb: (scope: unknown) => void) => {
      const scope: Scope = { tags: {}, fingerprint: [], extra: {}, processors: [] };
      current = scope;
      cb({
        setLevel: (l: string) => (scope.level = l),
        setTags: (t: Record<string, string>) => Object.assign(scope.tags, t),
        setFingerprint: (f: string[]) => (scope.fingerprint = f),
        setExtras: (e: Record<string, unknown>) => Object.assign(scope.extra, e),
        addEventProcessor: (p: (e: Record<string, unknown>) => Record<string, unknown>) => scope.processors.push(p),
      });
      current = null;
    },
    captureMessage: (message: string) => {
      const scope = current!;
      const event = scope.processors.reduce((e, p) => p(e), {} as Record<string, unknown>);
      order.push("capture");
      captured.push({ message, level: scope.level, tags: scope.tags, fingerprint: scope.fingerprint, extra: scope.extra, logger: event.logger as string | undefined });
    },
    flush: (ms?: number) => {
      order.push("flush");
      return flush(ms);
    },
  };
});
// The health check must not touch Slack: both ways in are replaced by something that fails the test.
const slackPost = vi.fn();
vi.mock("@/lib/operations-alerts", () => ({ sendOperationsAlert: slackPost }));
vi.mock("@/lib/slack-client", () => ({ createSlackClient: slackPost }));

let repos: Repos;
vi.mock("@/lib/data/repos", async () => ({
  ...(await vi.importActual<typeof import("@/lib/data/repos")>("@/lib/data/repos")),
  createRepos: () => repos,
}));

const { GET } = await import("@/app/api/internal/csp-health/route");

const NOW = Date.parse("2026-11-20T15:00:00Z");
const HOUR = 3_600_000;
const CHROME = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36";
const OLD_CHROME = CHROME.replace("Chrome/150", "Chrome/51");
const request = () => new NextRequest("http://localhost/api/internal/csp-health");

/** A member active in the last day: `requests` proxy rows, `pages` beacon rows (with the cookie unless `ga` is false), and `before` page views with it last month. */
async function member(n: number, { requests = 6, pages = 4, ga = true, before = 10, userAgent = CHROME } = {}) {
  const user_id = `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
  const at = (hoursAgo: number) => new Date(NOW - hoursAgo * HOUR).toISOString();
  for (let i = 0; i < requests; i++) await repos.accessEvents.record({ user_id, is_page: false, path: "/x", user_agent: userAgent, created_at: at(2 + i) });
  for (let i = 0; i < pages; i++) await repos.accessEvents.record({ user_id, is_page: true, path: "/x", user_agent: userAgent, ga_client_id: ga ? "GA1.1.1.1" : null, created_at: at(2 + i) });
  for (let i = 0; i < before; i++) await repos.accessEvents.record({ user_id, is_page: true, path: "/x", user_agent: userAgent, ga_client_id: "GA1.1.1.1", created_at: at(24 * 5 + i) });
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  heartbeat.mockClear();
  captured.length = 0;
  order.length = 0;
  slackPost.mockClear();
  flush.mockClear();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  requireAdmin.mockResolvedValue({ user: { id: "cron" }, forbidden: false });
  repos = createInMemoryRepos(new InMemoryDataset({}));
});

afterEach(() => vi.useRealTimers());

describe("GET /api/internal/csp-health", () => {
  it("refuses a request with no user and one that is not staff", async () => {
    requireAdmin.mockResolvedValueOnce({ user: null, forbidden: true });
    expect((await GET(request())).status).toBe(401);
    requireAdmin.mockResolvedValueOnce({ user: { id: "u" }, forbidden: true });
    expect((await GET(request())).status).toBe(403);
    expect(captured).toEqual([]);
    expect(heartbeat).not.toHaveBeenCalled();
  });

  it("says nothing when all is well, and still pings the heartbeat", async () => {
    for (let n = 1; n <= 30; n++) await member(n);
    const res = await GET(request());
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.alerted).toBe(false);
    expect(captured).toEqual([]);
    expect(flush).not.toHaveBeenCalled();
    expect(heartbeat).toHaveBeenCalledWith("csp-health");
  });

  it("says nothing with no activity at all", async () => {
    expect((await (await GET(request())).json()).alerted).toBe(false);
    expect(captured).toEqual([]);
  });

  it("alerts when members load pages but never run our scripts", async () => {
    for (let n = 1; n <= 28; n++) await member(n);
    await member(100, { pages: 0, before: 0 });
    await member(101, { pages: 0, before: 0 });
    await GET(request());
    expect(captured).toHaveLength(1);
    expect(captured[0]).toMatchObject({
      message: "CSP health: members load pages but never run our scripts",
      level: "error",
      tags: { logger: "csp-health", check: "stranded" },
      fingerprint: ["csp-health", "stranded"],
      logger: "csp-health",
      extra: { users: 2, of: 30, windowHours: CSP_HEALTH.windowHours, browsers: { "Chrome 150": 2 } },
    });
    expect(JSON.stringify(captured)).not.toMatch(/00000000-|Mozilla/);
    expect(slackPost).not.toHaveBeenCalled();
  });

  it("waits for the events to be sent before it answers", async () => {
    for (let n = 1; n <= 28; n++) await member(n);
    await member(100, { pages: 0, before: 0 });
    await member(101, { pages: 0, before: 0 });
    await GET(request());
    expect(flush).toHaveBeenCalledTimes(1);
    expect(order).toEqual(["capture", "flush"]);
  });

  it("sends the same message and fingerprint again tomorrow, so a lasting problem is one issue", async () => {
    for (let n = 1; n <= 28; n++) await member(n);
    await member(100, { pages: 0, before: 0 });
    await member(101, { pages: 0, before: 0 });
    await GET(request());
    await GET(request());
    expect(captured).toHaveLength(2);
    expect(captured[1]).toEqual(captured[0]);
  });

  it("sends one event per failing check", async () => {
    for (let n = 1; n <= 11; n++) await member(n);
    for (let n = 20; n < 24; n++) await member(n, { ga: false });
    await member(50, { userAgent: OLD_CHROME });
    await GET(request());
    expect(captured.map((c) => c.tags.check)).toEqual(["lost-google-cookie", "unsupported-browser"]);
    expect(slackPost).not.toHaveBeenCalled();
  });

  it("does not alert for members in a tab left open: they poll our API but have no new page view", async () => {
    for (let n = 1; n <= 20; n++) await member(n);
    for (const n of [60, 61, 62]) {
      await member(n, { pages: 0, requests: 0 });
      await repos.accessEvents.record({ user_id: `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`, is_page: false, path: "/api/live-room", user_agent: CHROME, created_at: new Date(NOW - HOUR).toISOString() });
    }
    await GET(request());
    expect(captured).toEqual([]);
  });

  it("alerts when members who had the Google cookie have lost it", async () => {
    for (let n = 1; n <= 12; n++) await member(n);
    for (let n = 20; n < 24; n++) await member(n, { ga: false });
    await GET(request());
    expect(captured).toHaveLength(1);
    expect(captured[0]).toMatchObject({ tags: { check: "lost-google-cookie" }, fingerprint: ["csp-health", "lost-google-cookie"], extra: { users: 4, of: 16 } });
  });

  it("does not alert for members who never had the cookie, however many", async () => {
    for (let n = 1; n <= 20; n++) await member(n);
    for (let n = 30; n < 40; n++) await member(n, { ga: false, before: 0 });
    await GET(request());
    expect(captured).toEqual([]);
  });

  it("alerts on a browser below the minimum, and ignores page views older than the window", async () => {
    for (let n = 1; n <= 10; n++) await member(n);
    await member(50, { userAgent: OLD_CHROME });
    await GET(request());
    expect(captured).toHaveLength(1);
    expect(captured[0]).toMatchObject({ tags: { check: "unsupported-browser" }, extra: { browsers: { "Chrome 51": 1 } } });
  });

  it("looks at the configured window: activity older than it is not counted", async () => {
    await member(1, { pages: 0, before: 0, requests: 0 });
    await repos.accessEvents.record({ user_id: "00000000-0000-0000-0000-000000000009", is_page: false, path: "/x", user_agent: OLD_CHROME, created_at: new Date(NOW - (CSP_HEALTH.windowHours + 1) * HOUR).toISOString() });
    await GET(request());
    expect(captured).toEqual([]);
  });

  it("handles more than 1000 members, all in the same state", async () => {
    const dataset = new InMemoryDataset({});
    repos = createInMemoryRepos(dataset);
    for (let n = 0; n < 1200; n++) {
      const user_id = `00000000-0000-0000-${String(Math.floor(n / 1e4)).padStart(4, "0")}-${String(n).padStart(12, "0")}`;
      await repos.accessEvents.record({ user_id, is_page: false, path: "/x", user_agent: CHROME, created_at: new Date(NOW - HOUR).toISOString() });
      await repos.accessEvents.record({ user_id, is_page: true, path: "/x", user_agent: CHROME, ga_client_id: "GA1.1.1.1", created_at: new Date(NOW - HOUR).toISOString() });
    }
    const body = await (await GET(request())).json();
    expect(body.stranded.of).toBe(1200);
    expect(body.alerted).toBe(false);
  });

  it("fails without a heartbeat when the access log cannot be read", async () => {
    vi.spyOn(repos.accessEvents, "activityForCspHealth").mockRejectedValue(new Error("boom"));
    const res = await GET(request());
    expect(res.status).toBe(500);
    expect(heartbeat).not.toHaveBeenCalled();
    expect(captured).toEqual([]);
  });
});
