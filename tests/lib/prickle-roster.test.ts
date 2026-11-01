import { describe, it, expect, vi } from "vitest";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { createInMemoryRepos } from "@/lib/data/repos";
import { loadPrickleRoster, ROSTER_LIMIT } from "@/lib/prickle-roster";
import { SCHEDULE_TIMEZONE } from "@/lib/commitments";

// Tue 2026-10-20 15:00 in New York (UTC-4): weekday 2, local time 15:00.
const TYPE = "ptyp_AAAAAAAAAAA1";
const PRICKLE = { id: "prkl_AAAAAAAAAAA1", type_id: TYPE, start_time: "2026-10-20T19:00:00.000Z" };

/** Member ids: m("1") is mbr_AAAAAAAAAAA1. */
const m = (n: string) => `mbr_AAAAAAAAAAA${n}`;

let commitmentCount = 0;
const commitment = (
  memberId: string,
  over: Partial<{ status: "active" | "cancelled" | "completed"; startDate: string; weeks: number; time: string; typeId: string; dayOfWeek: number; timezone: string }> = {}
) => ({
  id: `cmt_${++commitmentCount}`,
  memberId,
  // Four weeks from Mon 2026-10-12: through Sun 2026-11-08.
  startDate: over.startDate ?? "2026-10-12",
  weeks: over.weeks ?? 4,
  status: over.status ?? ("active" as const),
  slots: [{ typeId: over.typeId ?? TYPE, dayOfWeek: over.dayOfWeek ?? 2, startTimeLocal: over.time ?? "15:00:00", timezone: over.timezone ?? SCHEDULE_TIMEZONE }],
});

const member = (id: string, name: string, over: Partial<{ displayName: string | null; status: string }> = {}) => ({
  id,
  name,
  displayName: over.displayName ?? null,
  status: over.status ?? "active",
});

let itemCount = 0;
const onceItem = (memberId: string, prickleId = PRICKLE.id) => ({ id: `cfi_${++itemCount}`, member_id: memberId, kind: "prickle", prickle_id: prickleId });
const weeklyItem = (memberId: string, time: string, over: Partial<{ typeId: string; dayOfWeek: number; timezone: string }> = {}) => ({
  id: `cfi_${++itemCount}`,
  member_id: memberId,
  kind: "slot",
  type_id: over.typeId ?? TYPE,
  day_of_week: over.dayOfWeek ?? 2,
  start_time_local: time,
  timezone: over.timezone ?? SCHEDULE_TIMEZONE,
});

interface Setup {
  commitments?: ReturnType<typeof commitment>[];
  once?: string[];
  weekly?: { memberId: string; time: string }[];
  members?: ReturnType<typeof member>[];
  optedOut?: string[];
  items?: object[];
}

function reposFor({ commitments = [], once = [], weekly = [], members = [], optedOut = [], items = [] }: Setup) {
  return createInMemoryRepos(
    new InMemoryDataset({
      members,
      prickleCommitments: commitments,
      calendarFeedItems: [...once.map((id) => onceItem(id)), ...weekly.map((w) => weeklyItem(w.memberId, w.time)), ...items] as never,
      rosterOptOuts: optedOut.map((member_id) => ({ member_id, created_at: "2026-01-01T00:00:00Z" })),
    })
  );
}

const roster = (s: Setup, viewer: string | null = null, prickle: Parameters<typeof loadPrickleRoster>[1] = PRICKLE) =>
  loadPrickleRoster(reposFor(s), prickle, viewer);

describe("loadPrickleRoster", () => {
  it("lists a member whose active commitment covers this prickle's slot and date", async () => {
    const result = await roster({ commitments: [commitment(m("1"))], members: [member(m("1"), "Fern Quillsby")] });
    expect(result).toEqual({
      entries: [{ memberId: m("1"), name: "Fern Quillsby", reason: "committed", isYou: false, hiddenFromOthers: false }],
      total: 1,
    });
  });

  it.each([
    ["another type", { typeId: "ptyp_AAAAAAAAAAA2" }],
    ["another weekday", { dayOfWeek: 3 }],
    ["another time zone", { timezone: "UTC" }],
  ])("looks only at this prickle's type, weekday and time zone (%s)", async (_label, over) => {
    const result = await roster({ commitments: [commitment(m("1"), over)], members: [member(m("1"), "Fern")] });
    expect(result).toEqual({ entries: [], total: 0 });
  });

  it("finds 'just this one' calendar items by the prickle's id, and weekly ones by its type, weekday and time zone", async () => {
    const result = await roster({
      items: [
        onceItem(m("1")),
        onceItem(m("2"), "prkl_AAAAAAAAAAA2"), // another prickle
        weeklyItem(m("3"), "15:00:00"),
        weeklyItem(m("4"), "15:00:00", { typeId: "ptyp_AAAAAAAAAAA2" }),
        weeklyItem(m("5"), "15:00:00", { dayOfWeek: 3 }),
        weeklyItem(m("6"), "15:00:00", { timezone: "UTC" }),
      ],
      members: [member(m("1"), "Ana"), member(m("2"), "Bea"), member(m("3"), "Cy"), member(m("4"), "Di"), member(m("5"), "Ed"), member(m("6"), "Flo")],
    });
    expect(result.entries.map((e) => e.memberId)).toEqual([m("1"), m("3")]);
  });

  it.each([
    ["a cancelled commitment", { status: "cancelled" as const }],
    ["a finished one", { status: "completed" as const }],
    ["one that hasn't started yet", { startDate: "2026-10-27" }],
    ["one that ended before this prickle", { startDate: "2026-09-01" }], // four weeks: through Sep 28
    ["a different time of day", { time: "09:00:00" }],
  ])("leaves out %s", async (_label, over) => {
    const result = await roster({ commitments: [commitment(m("1"), over)], members: [member(m("1"), "Fern")] });
    expect(result).toEqual({ entries: [], total: 0 });
  });

  it("includes the first and last day of the commitment window", async () => {
    const result = await roster({
      // The first starts on the prickle's day; the second's four weeks end on it (Sep 23 + 27 days).
      commitments: [commitment(m("1"), { startDate: "2026-10-20" }), commitment(m("2"), { startDate: "2026-09-23" })],
      members: [member(m("1"), "Ana"), member(m("2"), "Bea")],
    });
    expect(result.entries.map((e) => e.memberId).sort()).toEqual([m("1"), m("2")]);
  });

  it("lists members who added just this prickle, or its weekly slot, to their calendar", async () => {
    const result = await roster({
      once: [m("1")],
      weekly: [
        { memberId: m("2"), time: "15:00:00" },
        { memberId: m("3"), time: "09:00:00" },
      ],
      members: [member(m("1"), "Ana"), member(m("2"), "Bea"), member(m("3"), "Cy")],
    });
    expect(result.entries.map((e) => [e.memberId, e.reason])).toEqual([
      [m("1"), "calendar"],
      [m("2"), "calendar"],
    ]);
  });

  it("shows committing rather than adding to a calendar for someone who did both, once", async () => {
    const result = await roster({
      commitments: [commitment(m("1"))],
      once: [m("1")],
      members: [member(m("1"), "Ana")],
    });
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0].reason).toBe("committed");
  });

  it("uses a member's display name when they have one", async () => {
    const result = await roster({
      commitments: [commitment(m("1"))],
      members: [member(m("1"), "Fernanda Quillsby", { displayName: "Fern Quillsby" })],
    });
    expect(result.entries[0].name).toBe("Fern Quillsby");
  });

  it("leaves out former members", async () => {
    const result = await roster({
      commitments: [commitment(m("1")), commitment(m("2"))],
      members: [member(m("1"), "Ana", { status: "cancelled" }), member(m("2"), "Bea")],
    });
    expect(result.entries.map((e) => e.memberId)).toEqual([m("2")]);
  });

  describe("opting out", () => {
    const s = (): Setup => ({
      commitments: [commitment(m("1")), commitment(m("2"))],
      members: [member(m("1"), "Ana"), member(m("2"), "Bea")],
      optedOut: [m("1")],
    });

    it("hides a member who opted out from everyone else", async () => {
      const result = await roster(s(), m("2"));
      expect(result.entries.map((e) => e.memberId)).toEqual([m("2")]);
      expect(result.total).toBe(1);
    });

    it("still shows them to themselves, marked as hidden", async () => {
      const result = await roster(s(), m("1"));
      expect(result.entries.map((e) => [e.memberId, e.isYou, e.hiddenFromOthers])).toEqual([
        [m("1"), true, true],
        [m("2"), false, false],
      ]);
    });

    it("hides them from a viewer with no member record too", async () => {
      expect((await roster(s(), null)).entries.map((e) => e.memberId)).toEqual([m("2")]);
    });
  });

  it("puts you first, then those who committed, then the rest by name", async () => {
    const result = await roster(
      {
        commitments: [commitment(m("3"))],
        once: [m("1"), m("2"), m("4")],
        members: [member(m("1"), "Zed"), member(m("2"), "Amy"), member(m("3"), "Mo"), member(m("4"), "Bo")],
      },
      m("4")
    );
    expect(result.entries.map((e) => e.name)).toEqual(["Bo", "Mo", "Amy", "Zed"]);
  });

  it("cuts a long list off, keeping the total", async () => {
    const ids = Array.from({ length: ROSTER_LIMIT + 10 }, (_, i) => `mbr_${String(i).padStart(12, "A")}`);
    const result = await roster({ once: ids, members: ids.map((id) => member(id, `Member ${id}`)) });
    expect(result.entries).toHaveLength(ROSTER_LIMIT);
    expect(result.total).toBe(ROSTER_LIMIT + 10);
  });

  it("has no slot-based sign-ups for a prickle with no type, only 'just this one' and the host", async () => {
    const repos = reposFor({
      commitments: [commitment(m("1"))],
      weekly: [{ memberId: m("2"), time: "15:00:00" }],
      once: [m("3")],
      members: [member(m("1"), "Ana"), member(m("2"), "Bea"), member(m("3"), "Cy"), member(m("4"), "Di")],
    });
    const commitments = vi.spyOn(repos.prickleActivity, "slotCommitments");
    const weekly = vi.spyOn(repos.calendarFeed, "weeklySlotMembers");

    const result = await loadPrickleRoster(repos, { ...PRICKLE, type_id: null, host_id: m("4") }, null);

    expect(result.entries.map((e) => [e.memberId, e.reason])).toEqual([
      [m("4"), "host"],
      [m("3"), "calendar"],
    ]);
    expect(commitments).not.toHaveBeenCalled();
    expect(weekly).not.toHaveBeenCalled();
  });

  describe("the host", () => {
    const s = (): Setup => ({
      commitments: [commitment(m("2"))],
      once: [m("3")],
      members: [member(m("1"), "Zoe Host"), member(m("2"), "Bea"), member(m("3"), "Cy")],
    });
    const withHost = { ...PRICKLE, host_id: m("1") };

    it("is listed first, then those who committed, then calendar adds", async () => {
      const result = await roster(s(), null, withHost);
      expect(result.entries.map((e) => [e.name, e.reason])).toEqual([
        ["Zoe Host", "host"],
        ["Bea", "committed"],
        ["Cy", "calendar"],
      ]);
    });

    it("stays listed as host even after opting out, since the page names them anyway", async () => {
      const result = await roster({ ...s(), optedOut: [m("1")] }, m("2"), withHost);
      const host = result.entries.find((e) => e.memberId === m("1"));
      expect(host).toMatchObject({ reason: "host", hiddenFromOthers: false });
    });

    it("shows hosting rather than committed or calendar for a host who also signed up", async () => {
      const result = await roster({ ...s(), once: [m("1")], commitments: [commitment(m("1"))] }, null, withHost);
      expect(result.entries.filter((e) => e.memberId === m("1")).map((e) => e.reason)).toEqual(["host"]);
    });

    it("isn't listed when they've left", async () => {
      const result = await roster({ ...s(), members: [member(m("1"), "Zoe Host", { status: "cancelled" })] }, null, withHost);
      expect(result.entries).toEqual([]);
    });
  });
});

describe("loadPrickleRoster when the calendar items can't be read", () => {
  it("still lists the committed members, and logs why", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const repos = reposFor({ commitments: [commitment(m("1"))], members: [member(m("1"), "Fern Quillsby")] });
    repos.calendarFeed.memberIdsWithPrickle = async () => {
      throw new Error("database is down");
    };
    repos.calendarFeed.weeklySlotMembers = async () => {
      throw new Error("database is down");
    };

    const result = await loadPrickleRoster(repos, PRICKLE, null);

    expect(result.entries.map((e) => [e.memberId, e.reason])).toEqual([[m("1"), "committed"]]);
    expect(log).toHaveBeenCalledWith("prickle roster: failed to read calendar items", expect.any(Error));
    log.mockRestore();
  });
});
