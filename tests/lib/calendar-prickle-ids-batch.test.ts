import { describe, it, expect, vi } from "vitest";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { createInMemoryRepos } from "@/lib/data/repos";
import { loadCalendarPrickleIdsByMember } from "@/lib/prickle-checkin-dms";
import { loadCalendarFeedPrickleIds, preloadPrickleReader } from "@/lib/calendar-feed";

// HUB-1X: the check-in route read the prickles table once per active member. These use the real
// calendar loader on the in-memory repositories and count the prickle reads.

const TYPE = { id: "t1", name: "Progress Prickle", normalizedName: "progress", purpose: "writing", requiresHost: false, soloTaskFriendly: false, listedInEvents: false, announcedPublicly: false, guestsAllowed: false };
const NOW = new Date("2026-11-23T18:00:00.000Z");
const at = (minutes: number) => new Date(NOW.getTime() + minutes * 60_000).toISOString();
const prickle = (id: string, hostId: string | null, minutes: number) => ({
  id, typeId: TYPE.id, hostId, title: null, startTime: at(minutes), endTime: at(minutes + 60), source: "calendar", calendarEventId: null,
});

function setup(memberCount: number, prickles: ReturnType<typeof prickle>[]) {
  const members = Array.from({ length: memberCount }, (_, i) => ({ id: `m${i}`, name: `Member ${i} Example` }));
  const dataset = new InMemoryDataset({ members, prickleTypes: [TYPE], prickles });
  const repos = createInMemoryRepos(dataset);
  const startingBetween = vi.spyOn(repos.prickles, "startingBetween");
  const byIds = vi.spyOn(repos.prickles, "byIds");
  return { repos, members: members.map((m) => m.id), startingBetween, byIds };
}

describe("loadCalendarPrickleIdsByMember", () => {
  it("reads the prickles once however many members there are", async () => {
    const prickles = [prickle("p1", "m0", 20), prickle("p2", "m3", 25), prickle("p3", null, 28)];
    const small = setup(2, prickles);
    await loadCalendarPrickleIdsByMember(small.repos, small.members, new Date(at(15)), NOW);
    const large = setup(25, prickles);
    await loadCalendarPrickleIdsByMember(large.repos, large.members, new Date(at(15)), NOW);
    expect(small.startingBetween).toHaveBeenCalledTimes(1);
    expect(large.startingBetween).toHaveBeenCalledTimes(1);
    expect(large.byIds).not.toHaveBeenCalled();
  });

  it("gives each member the prickles they host, as the per-member loader does", async () => {
    const { repos, members } = setup(5, [prickle("p1", "m0", 20), prickle("p2", "m3", 25), prickle("p3", null, 28)]);
    const since = new Date(at(15));
    const batch = await loadCalendarPrickleIdsByMember(repos, members, since, NOW);
    expect(batch.get("m0")).toEqual(new Set(["p1"]));
    expect(batch.get("m3")).toEqual(new Set(["p2"]));
    expect(batch.get("m1")).toEqual(new Set());
    for (const id of members) {
      expect(batch.get(id)).toEqual(await loadCalendarFeedPrickleIds(repos, id, since, NOW));
    }
  });

  it("reads nothing with no members, and gives empty sets with no prickles", async () => {
    const none = setup(0, []);
    expect((await loadCalendarPrickleIdsByMember(none.repos, [], NOW, NOW)).size).toBe(0);
    expect(none.startingBetween).not.toHaveBeenCalled();
    const empty = setup(3, []);
    const result = await loadCalendarPrickleIdsByMember(empty.repos, empty.members, NOW, NOW);
    expect(result.get("m1")).toEqual(new Set());
  });
});

describe("preloadPrickleReader", () => {
  it("filters by window, end inclusivity, types and host like the repository", async () => {
    const { repos, startingBetween } = setup(1, [prickle("a", "m0", 10), prickle("b", "m0", 20), prickle("c", "x", 30)]);
    const reader = await preloadPrickleReader(repos, new Date(at(0)));
    const ids = async (w: Parameters<typeof reader.startingBetween>[0]) => (await reader.startingBetween(w)).map((p) => p.id);
    expect(await ids({ from: at(10), to: at(30) })).toEqual(["a", "b"]);
    expect(await ids({ from: at(10), to: at(30), inclusiveEnd: true })).toEqual(["a", "b", "c"]);
    expect(await ids({ from: at(0), hostId: "m0" })).toEqual(["a", "b"]);
    expect(await ids({ from: at(0), typeIds: ["other"] })).toEqual([]);
    expect(await ids({ from: at(0), typeIds: [TYPE.id] })).toEqual(["a", "b", "c"]);
    expect(startingBetween).toHaveBeenCalledTimes(1);
    expect((await reader.byIds(["b", "zzz"])).map((p) => p.id)).toEqual(["b"]);
  });

  it("falls back to the repository for a read that starts before the preload", async () => {
    const { repos, startingBetween } = setup(1, [prickle("a", "m0", 10)]);
    const reader = await preloadPrickleReader(repos, new Date(at(5)));
    await reader.startingBetween({ from: at(-60) });
    await reader.startingBetween({ from: at(5), includeEventType: true });
    expect(startingBetween).toHaveBeenCalledTimes(3);
  });
});
