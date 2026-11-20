import { describe, expect, it, vi } from "vitest";
import { InMemoryAccessEventRepository, SupabaseAccessEventRepository } from "@/lib/data/access-events";
import type { Db } from "@/lib/data/db";
import { InMemoryDataset } from "@/lib/data/in-memory";

const window = { since: new Date("2026-11-19T15:00:00Z"), until: new Date("2026-11-20T15:00:00Z"), historySince: new Date("2026-10-20T15:00:00Z") };

describe("SupabaseAccessEventRepository.activityForCspHealth", () => {
  const sqlRow = (n: number) => ({
    user_id: `u${n}`,
    user_agent: "ua",
    requests: "3",
    script_requests: "2",
    page_views: 2,
    page_views_with_ga: 1,
    history_page_views_with_ga: 7,
  });

  it("passes the three bounds to the aggregate and follows the 1000-row pages", async () => {
    const all = Array.from({ length: 2300 }, (_, i) => sqlRow(i));
    const ranges: [number, number][] = [];
    const rpc = vi.fn((_name: string, _args: unknown) => ({
      range: async (from: number, to: number) => {
        ranges.push([from, to]);
        return { data: all.slice(from, to + 1), error: null };
      },
    }));
    const rows = await new SupabaseAccessEventRepository({ rpc } as unknown as Db).activityForCspHealth(window);

    expect(rpc).toHaveBeenCalledWith("csp_rollout_activity", {
      p_since: "2026-11-19T15:00:00.000Z",
      p_until: "2026-11-20T15:00:00.000Z",
      p_history_since: "2026-10-20T15:00:00.000Z",
    });
    expect(ranges).toEqual([[0, 999], [1000, 1999], [2000, 2999]]);
    expect(rows).toHaveLength(2300);
    expect(rows[0]).toEqual({ userId: "u0", userAgent: "ua", requests: 3, scriptRequests: 2, pageViews: 2, pageViewsWithGa: 1, historyPageViewsWithGa: 7 });
  });

  it("throws on a database error", async () => {
    const rpc = () => ({ range: async () => ({ data: null, error: { message: "statement timeout" } }) });
    await expect(new SupabaseAccessEventRepository({ rpc } as unknown as Db).activityForCspHealth(window)).rejects.toThrow("statement timeout");
  });
});

describe("InMemoryAccessEventRepository.activityForCspHealth", () => {
  it("groups the window per user and user agent, with the history only from before it", async () => {
    const repo = new InMemoryAccessEventRepository(new InMemoryDataset({}));
    const at = (iso: string) => ({ created_at: iso, path: "/x" });
    await repo.record({ user_id: "a", is_page: false, user_agent: "ua1", ...at("2026-11-20T10:00:00Z") });
    await repo.record({ user_id: "a", is_page: true, user_agent: "ua1", ga_client_id: "g", ...at("2026-11-20T10:01:00Z") });
    await repo.record({ user_id: "a", is_page: true, user_agent: "ua2", ...at("2026-11-20T11:00:00Z") });
    await repo.record({ user_id: "a", is_page: true, user_agent: "ua1", ga_client_id: "g", ...at("2026-11-01T11:00:00Z") });
    await repo.record({ user_id: "a", is_page: true, user_agent: "ua1", ga_client_id: "g", ...at("2026-09-01T11:00:00Z") });
    await repo.record({ user_id: "b", is_page: false, user_agent: null, ...at("2026-11-19T15:00:00Z") });
    await repo.record({ user_id: "b", is_page: false, user_agent: null, ...at("2026-11-20T15:00:00Z") });

    expect(await repo.activityForCspHealth(window)).toEqual([
      { userId: "a", userAgent: "ua1", requests: 1, scriptRequests: 0, pageViews: 1, pageViewsWithGa: 1, historyPageViewsWithGa: 1 },
      { userId: "a", userAgent: "ua2", requests: 0, scriptRequests: 0, pageViews: 1, pageViewsWithGa: 0, historyPageViewsWithGa: 1 },
      { userId: "b", userAgent: null, requests: 1, scriptRequests: 0, pageViews: 0, pageViewsWithGa: 0, historyPageViewsWithGa: 0 },
    ]);
  });

  it("counts as script requests the API calls (not images) and three pages in one second, never one page load", async () => {
    const repo = new InMemoryAccessEventRepository(new InMemoryDataset({}));
    const req = (user_id: string, path: string, created_at: string) => repo.record({ user_id, is_page: false, user_agent: "ua", path, created_at });
    await req("api", "/api/live-room", "2026-11-20T10:00:00Z");
    await req("api", "/api/media/med_1/card", "2026-11-20T10:00:01Z");
    await req("api", "/api/chat/unfurl-image?u=x", "2026-11-20T10:00:02Z");
    for (const path of ["/dashboard", "/courses", "/chat"]) await req("burst", path, "2026-11-20T10:00:00.100Z");
    await req("burst", "/chat", "2026-11-20T10:00:00.200Z");
    for (const path of ["/dashboard", "/courses"]) await req("two", path, "2026-11-20T10:00:00Z");
    await req("two", "/dashboard", "2026-11-20T10:00:00.5Z");

    const by = Object.fromEntries((await repo.activityForCspHealth(window)).map((r) => [r.userId, r]));
    expect(by.api).toMatchObject({ requests: 3, scriptRequests: 1 });
    expect(by.burst).toMatchObject({ requests: 4, scriptRequests: 4 });
    expect(by.two).toMatchObject({ requests: 3, scriptRequests: 0 });
  });
});
