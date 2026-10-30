import { describe, it, expect, vi, beforeEach } from "vitest";
import { enforceNetworkRetention, NETWORK_RETENTION_BUDGET_MS } from "@/lib/retention/network-details";
import { RETENTION } from "@/lib/retention";
import { useFakeClock } from "@/tests/helpers/fake-clock";

const CHROME_MAC =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
const SAFARI_IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";

type Call = { fn: string; args: Record<string, unknown> };

/** A database whose three functions answer from scripts, recording every call. */
function fakeDb(script: {
  pending?: Partial<Record<string, string[][]>>; // per source: pages of strings, then []
  changed?: number[][]; // per string, in order: row counts per call, then 0
  removed?: { source: string; removed: number }[][];
  error?: { fn: string; message: string };
}) {
  const calls: Call[] = [];
  const pendingPages = { ...script.pending };
  const changedPerString = [...(script.changed ?? [])];
  let currentChanged: number[] = [];
  const removedPages = [...(script.removed ?? [])];
  const db = {
    rpc: vi.fn(async (fn: string, args: Record<string, unknown>) => {
      calls.push({ fn, args });
      if (script.error?.fn === fn) return { data: null, error: { message: script.error.message } };
      if (fn === "retention_pending_user_agents") {
        const pages = pendingPages[args.p_source as string] ?? [];
        return { data: pages.shift() ?? [], error: null };
      }
      if (fn === "retention_set_device") {
        if (currentChanged.length === 0) currentChanged = changedPerString.shift() ?? [0];
        return { data: currentChanged.shift() ?? 0, error: null };
      }
      if (fn === "retention_remove_raw_network") return { data: removedPages.shift() ?? [], error: null };
      throw new Error(`unexpected rpc ${fn}`);
    }),
  };
  return { db: db as never, calls, rpc: db.rpc };
}

describe("enforceNetworkRetention", () => {
  const fake = useFakeClock(() => Date.parse("2026-12-01T00:00:00Z"));

  beforeEach(() => vi.clearAllMocks());

  it("parses each distinct user agent once and stores its device, until none is left", async () => {
    const { db, calls } = fakeDb({
      pending: { access_events: [[CHROME_MAC, SAFARI_IPHONE], []] },
      // Chrome: 5000 then 120 rows, then none; Safari: 40 then none.
      changed: [[5000, 120, 0], [40, 0]],
    });

    const result = await enforceNetworkRetention(db);

    const sets = calls.filter((c) => c.fn === "retention_set_device");
    expect(sets.map((c) => c.args.p_user_agent)).toEqual([CHROME_MAC, CHROME_MAC, CHROME_MAC, SAFARI_IPHONE, SAFARI_IPHONE]);
    expect(sets[0].args).toMatchObject({
      p_source: "access_events",
      p_device: { browser: "Chrome", browser_version: "126.0.0.0", os: "macOS", os_version: null, device_type: "desktop" },
      p_limit: 5000,
    });
    expect(sets[3].args.p_device).toMatchObject({ browser: "Safari", os: "iOS", os_version: "17.5", device_type: "phone" });
    expect(result.devicesStored).toEqual({ access_events: 5160, video_watch_segments: 0, analytics_events: 0 });
    expect(result.stoppedEarly).toBe(false);
  });

  it("stores {} for a string with nothing readable, so it is not looked at again", async () => {
    const { db, calls } = fakeDb({ pending: { video_watch_segments: [["curl/8.1"], []] }, changed: [[3, 0]] });
    await enforceNetworkRetention(db);
    const set = calls.find((c) => c.fn === "retention_set_device")!;
    expect(set.args).toMatchObject({ p_source: "video_watch_segments", p_user_agent: "curl/8.1", p_device: {} });
  });

  it("puts only the parsed fields into a usage event's context, never the raw string", async () => {
    const { db, calls } = fakeDb({ pending: { analytics_events: [[SAFARI_IPHONE], []] }, changed: [[7, 0]] });
    const result = await enforceNetworkRetention(db);
    const set = calls.find((c) => c.fn === "retention_set_device")!;
    expect(set.args.p_source).toBe("analytics_events");
    expect(set.args.p_device).toEqual({ browser: "Safari", browser_version: "17.5", os: "iOS", os_version: "17.5", device_type: "phone" });
    expect(JSON.stringify(set.args)).not.toContain("device_type\":null");
    expect(result.devicesStored.analytics_events).toBe(7);
  });

  it("removes raw values older than the retention period, in batches, then stops when nothing is left", async () => {
    const { db, calls } = fakeDb({
      removed: [
        [{ source: "access_events", removed: 5000 }, { source: "video_watch_segments", removed: 12 }],
        [{ source: "access_events", removed: 300 }, { source: "video_watch_segments", removed: 0 }],
        [{ source: "access_events", removed: 0 }, { source: "video_watch_segments", removed: 0 }],
      ],
    });

    const result = await enforceNetworkRetention(db);

    const removes = calls.filter((c) => c.fn === "retention_remove_raw_network");
    expect(removes).toHaveLength(3);
    // The cutoff is the retention constant the privacy page prints, counted back from now.
    const expected = new Date(Date.parse("2026-12-01T00:00:00Z") - RETENTION.rawNetworkDays * 86_400_000).toISOString();
    expect(removes.every((c) => c.args.p_cutoff === expected)).toBe(true);
    expect(result.removed).toEqual({ access_events: 5300, video_watch_segments: 12 });
  });

  it("keeps the device before removing anything: every device is stored first", async () => {
    const { db, calls } = fakeDb({ pending: { access_events: [[CHROME_MAC], []] }, changed: [[10, 0]] });
    await enforceNetworkRetention(db);
    const order = calls.map((c) => c.fn);
    expect(order.lastIndexOf("retention_set_device")).toBeLessThan(order.indexOf("retention_remove_raw_network"));
  });

  it("stops at its time budget and says so, leaving the rest for the next run", async () => {
    const { db, rpc } = fakeDb({ pending: { access_events: [[CHROME_MAC], []] } });
    rpc.mockImplementationOnce(async () => {
      fake.clock.advance(NETWORK_RETENTION_BUDGET_MS);
      return { data: [CHROME_MAC], error: null };
    });

    const result = await enforceNetworkRetention(db);

    expect(result.stoppedEarly).toBe(true);
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("does nothing, and says so, when there is nothing to do", async () => {
    const { db } = fakeDb({});
    expect(await enforceNetworkRetention(db)).toEqual({
      devicesStored: { access_events: 0, video_watch_segments: 0, analytics_events: 0 },
      removed: { access_events: 0, video_watch_segments: 0 },
      stoppedEarly: false,
    });
  });

  it.each(["retention_pending_user_agents", "retention_set_device", "retention_remove_raw_network"])("fails loudly when %s fails, rather than reporting a clean run", async (fn) => {
    const { db } = fakeDb({
      pending: { access_events: [[CHROME_MAC]] },
      changed: [[1, 0]],
      error: { fn, message: "boom" },
    });
    await expect(enforceNetworkRetention(db)).rejects.toThrow(new RegExp(`${fn}.*boom`));
  });
});
