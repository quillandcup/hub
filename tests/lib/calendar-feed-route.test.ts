import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { createInMemoryRepos } from "@/lib/data/repos";

let repos = createInMemoryRepos();
vi.mock("@/lib/data/repos", async () => ({
  ...(await vi.importActual<typeof import("@/lib/data/repos")>("@/lib/data/repos")),
  createRepos: () => repos,
}));
vi.mock("@/lib/supabase/service", () => ({ createServiceRoleClient: () => ({}) }));
const loadCalendarFeedEvents = vi.fn(async (..._args: unknown[]): Promise<unknown[]> => []);
vi.mock("@/lib/calendar-feed", async () => ({
  ...(await vi.importActual<typeof import("@/lib/calendar-feed")>("@/lib/calendar-feed")),
  loadCalendarFeedEvents: (...args: unknown[]) => loadCalendarFeedEvents(...args),
}));

const { GET } = await import("@/app/api/calendar/feed/[token]/route");

const TOKEN = "0123456789abcdef0123456789abcdef";
const ME = "mbr_AAAAAAAAAAA1";
const get = (segment: string) =>
  GET(new NextRequest(`https://hub.example.test/api/calendar/feed/${segment}`), { params: Promise.resolve({ token: segment }) });

beforeEach(async () => {
  repos = createInMemoryRepos();
  loadCalendarFeedEvents.mockClear();
  await repos.calendarFeed.createTokenIfMissing(ME, TOKEN);
});

describe("GET /api/calendar/feed/<token>.ics", () => {
  it("serves the token's member's feed, privately, and records the first fetch once", async () => {
    const res = await get(`${TOKEN}.ics`);

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/calendar; charset=utf-8");
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(loadCalendarFeedEvents).toHaveBeenCalledWith(expect.anything(), ME, "https://hub.example.test", expect.any(Date));
    const first = (await repos.calendarFeed.ownerOfToken(TOKEN))!.firstFetchedAt;
    expect(first).not.toBeNull();

    await get(`${TOKEN}.ics`);
    expect((await repos.calendarFeed.ownerOfToken(TOKEN))!.firstFetchedAt).toBe(first);
  });

  it("answers 404 for something that isn't a token, and for one that was never issued or was replaced", async () => {
    expect((await get("nope.ics")).status).toBe(404);
    expect((await get(`${"f".repeat(32)}.ics`)).status).toBe(404);

    await repos.calendarFeed.replaceToken(ME, "f".repeat(32));
    expect((await get(`${TOKEN}.ics`)).status).toBe(404);
    expect(loadCalendarFeedEvents).not.toHaveBeenCalled();
  });

  it("answers 500 without leaking the token when the lookup fails", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(repos.calendarFeed, "ownerOfToken").mockRejectedValueOnce(new Error("database is down"));

    const res = await get(`${TOKEN}.ics`);

    expect(res.status).toBe(500);
    expect(await res.text()).toBe("Calendar feed unavailable");
    expect(JSON.stringify(log.mock.calls)).not.toContain(TOKEN);
    log.mockRestore();
  });

  it("still serves the feed when recording the first fetch fails", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(repos.calendarFeed, "recordFirstFetch").mockRejectedValueOnce(new Error("database is down"));

    expect((await get(`${TOKEN}.ics`)).status).toBe(200);
    expect(log).toHaveBeenCalledWith("calendar feed: failed to record first fetch", expect.any(Error));
    log.mockRestore();
  });

  it("answers 500 when the feed can't be built", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    loadCalendarFeedEvents.mockRejectedValueOnce(new Error("database is down"));

    expect((await get(`${TOKEN}.ics`)).status).toBe(500);
    log.mockRestore();
  });
});
