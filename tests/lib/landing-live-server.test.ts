import { describe, expect, it, vi } from "vitest";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { createInMemoryRepos } from "@/lib/data/repos";
import { useFakeClock } from "@/tests/helpers/fake-clock";

const NOW = Date.parse("2026-11-19T15:00:00Z");

const mocks = vi.hoisted(() => ({
  cacheCalls: [] as { keyParts: string[]; options: { revalidate?: number; tags?: string[] } }[],
  repos: undefined as unknown,
}));

// A pass-through cache that records how it was set up: the real one needs a running Next server.
vi.mock("next/cache", () => ({
  unstable_cache: (fn: (...args: never[]) => unknown, keyParts: string[], options: { revalidate?: number; tags?: string[] }) => {
    mocks.cacheCalls.push({ keyParts, options });
    return fn;
  },
}));
vi.mock("@/lib/data/server", () => ({ getServiceRepos: () => mocks.repos }));

import { LIVE_CACHE_SECONDS, LIVE_CACHE_TAG, withLiveData } from "@/lib/landing/live-server";

const type = { id: "ptyp_pub", name: "Open Mic", normalizedName: "open-mic", purpose: "social", requiresHost: false, soloTaskFriendly: false, listedInEvents: true, announcedPublicly: true, guestsAllowed: false };
const prickle = { id: "prkl_1", typeId: type.id, hostId: null, title: "Open Mic", startTime: "2026-11-19T15:20:00Z", endTime: "2026-11-19T16:20:00Z", source: "calendar", calendarEventId: null };
const stay = { id: "att_1", memberId: "mbr_1", prickleId: prickle.id, joinTime: "2026-11-18T15:20:00Z", leaveTime: "2026-11-18T16:20:00Z" };

const data = {
  content: [
    { type: "AnnouncementStrip", props: { id: "s", source: "live", text: "typed", buttonLabel: "Drop in", href: "/join", tone: "gold" } },
    { type: "OutcomeNumbers", props: { id: "o", items: [{ source: "live", stat: "prickles_30d", value: "typed" }] } },
  ],
  root: { props: {} },
};

describe("live data on the server", () => {
  const fake = useFakeClock(() => NOW);

  it("caches each aggregate for about a minute, so traffic cannot multiply database load", () => {
    expect(LIVE_CACHE_SECONDS).toBe(60);
    expect(mocks.cacheCalls).toHaveLength(3);
    for (const call of mocks.cacheCalls) expect(call.options).toEqual({ revalidate: 60, tags: [LIVE_CACHE_TAG] });
    expect(new Set(mocks.cacheCalls.map((c) => c.keyParts.join("/"))).size).toBe(3);
  });

  it("resolves a page against the repositories at the clock's time, without touching the stored page", async () => {
    mocks.repos = createInMemoryRepos(new InMemoryDataset({ prickleTypes: [type], prickles: [prickle], attendance: [stay] } as never));
    const before = JSON.stringify(data);

    const out = (await withLiveData(data)) as { content: { props: Record<string, unknown> & { items?: Record<string, unknown>[] } }[] };

    expect(out.content[0].props.live).toEqual({ text: "Your next prickle starts in 20 minutes" });
    expect(out.content[1].props.items![0].live).toEqual({ value: "1", caption: expect.stringContaining("prickles") });
    expect(JSON.stringify(data)).toBe(before);
    fake.clock.advance(15 * 60_000);
    expect(((await withLiveData(data)) as typeof out).content[0].props.live).toEqual({ text: "Your next prickle starts in 5 minutes" });
  });

  it("falls back to the typed values when the database fails, logging only a code", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.repos = new Proxy({}, { get: () => { throw new Error("connection refused for Ada Example"); } });

    const out = (await withLiveData(data)) as { content: { props: Record<string, unknown> & { items?: Record<string, unknown>[] } }[] };

    expect(out.content[0].props).not.toHaveProperty("live");
    expect(out.content[1].props.items![0]).not.toHaveProperty("live");
    expect(log.mock.calls.map((c) => c[0]).sort()).toEqual(["landing_live_schedule_failed", "landing_live_stats_failed"]);
    expect(JSON.stringify(log.mock.calls)).not.toContain("Ada Example");
    log.mockRestore();
  });
});
