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
const sendOperationsAlert = vi.fn(async () => {});
vi.mock("@/lib/operations-alerts", () => ({ sendOperationsAlert: (...args: unknown[]) => (sendOperationsAlert as (...a: unknown[]) => unknown)(...args) }));

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
  sendOperationsAlert.mockClear();
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
    expect(sendOperationsAlert).not.toHaveBeenCalled();
    expect(heartbeat).not.toHaveBeenCalled();
  });

  it("says nothing when all is well, and still pings the heartbeat", async () => {
    for (let n = 1; n <= 30; n++) await member(n);
    const res = await GET(request());
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.alerted).toBe(false);
    expect(sendOperationsAlert).not.toHaveBeenCalled();
    expect(heartbeat).toHaveBeenCalledWith("csp-health");
  });

  it("says nothing with no activity at all", async () => {
    expect((await (await GET(request())).json()).alerted).toBe(false);
    expect(sendOperationsAlert).not.toHaveBeenCalled();
  });

  it("alerts when members load pages but never run our scripts", async () => {
    for (let n = 1; n <= 28; n++) await member(n);
    await member(100, { pages: 0, before: 0 });
    await member(101, { pages: 0, before: 0 });
    await GET(request());
    expect(sendOperationsAlert).toHaveBeenCalledTimes(1);
    const [, alert] = sendOperationsAlert.mock.calls[0] as unknown as [unknown, { type: string; problems: string[] }];
    expect(alert.type).toBe("csp_health");
    expect(alert.problems).toHaveLength(1);
    expect(alert.problems[0]).toContain("2 of 30 active members loaded pages but never ran our scripts");
    expect(alert.problems[0]).toContain("Chrome 150 (2)");
    expect(JSON.stringify(alert)).not.toMatch(/00000000-|Mozilla/);
  });

  it("does not alert for members in a tab left open: they poll our API but have no new page view", async () => {
    for (let n = 1; n <= 20; n++) await member(n);
    for (const n of [60, 61, 62]) {
      await member(n, { pages: 0, requests: 0 });
      await repos.accessEvents.record({ user_id: `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`, is_page: false, path: "/api/live-room", user_agent: CHROME, created_at: new Date(NOW - HOUR).toISOString() });
    }
    await GET(request());
    expect(sendOperationsAlert).not.toHaveBeenCalled();
  });

  it("alerts when members who had the Google cookie have lost it", async () => {
    for (let n = 1; n <= 12; n++) await member(n);
    for (let n = 20; n < 24; n++) await member(n, { ga: false });
    await GET(request());
    const [, alert] = sendOperationsAlert.mock.calls[0] as unknown as [unknown, { problems: string[] }];
    expect(alert.problems).toHaveLength(1);
    expect(alert.problems[0]).toContain("4 of 16 members who had the Google Analytics cookie");
  });

  it("does not alert for members who never had the cookie, however many", async () => {
    for (let n = 1; n <= 20; n++) await member(n);
    for (let n = 30; n < 40; n++) await member(n, { ga: false, before: 0 });
    await GET(request());
    expect(sendOperationsAlert).not.toHaveBeenCalled();
  });

  it("alerts on a browser below the minimum, and ignores page views older than the window", async () => {
    for (let n = 1; n <= 10; n++) await member(n);
    await member(50, { userAgent: OLD_CHROME });
    await GET(request());
    const [, alert] = sendOperationsAlert.mock.calls[0] as unknown as [unknown, { problems: string[] }];
    expect(alert.problems.join("\n")).toContain("Chrome 51 (1)");
  });

  it("looks at the configured window: activity older than it is not counted", async () => {
    await member(1, { pages: 0, before: 0, requests: 0 });
    await repos.accessEvents.record({ user_id: "00000000-0000-0000-0000-000000000009", is_page: false, path: "/x", user_agent: OLD_CHROME, created_at: new Date(NOW - (CSP_HEALTH.windowHours + 1) * HOUR).toISOString() });
    await GET(request());
    expect(sendOperationsAlert).not.toHaveBeenCalled();
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
    expect(sendOperationsAlert).not.toHaveBeenCalled();
  });
});
