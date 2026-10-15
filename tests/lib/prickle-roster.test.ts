import { describe, it, expect } from "vitest";
import { createFakeSupabase, type FakeQuery } from "@/tests/helpers/server-page";
import { loadPrickleRoster, ROSTER_LIMIT } from "@/lib/prickle-roster";
import { SCHEDULE_TIMEZONE } from "@/lib/commitments";

// Tue 2026-10-20 15:00 in New York (UTC-4): weekday 2, local time 15:00.
const PRICKLE = { id: "p1", type_id: "t1", start_time: "2026-10-20T19:00:00.000Z" };

const eqCall = (query: FakeQuery, column: string) => query.calls.find((c) => c.method === "eq" && c.args[0] === column)?.args[1];

const commitment = (memberId: string, over: Partial<{ status: string; start_date: string; end_date: string; time: string }> = {}) => ({
  start_time_local: over.time ?? "15:00:00",
  prickle_commitments: {
    member_id: memberId,
    status: over.status ?? "active",
    start_date: over.start_date ?? "2026-10-12",
    end_date: over.end_date ?? "2026-11-08",
  },
});

const member = (id: string, name: string, over: Partial<{ display_name: string | null; status: string }> = {}) => ({
  id,
  name,
  display_name: over.display_name ?? null,
  status: over.status ?? "active",
});

interface Setup {
  commitments?: object[];
  once?: string[];
  weekly?: { member_id: string; start_time_local: string }[];
  members?: ReturnType<typeof member>[];
  optedOut?: string[];
}

function setup({ commitments = [], once = [], weekly = [], members = [], optedOut = [] }: Setup) {
  return createFakeSupabase({
    prickle_commitment_slots: { data: commitments },
    calendar_feed_items: (query) =>
      eqCall(query, "kind") === "prickle"
        ? { data: once.map((member_id) => ({ member_id })) }
        : { data: weekly },
    member_roster_opt_outs: { data: optedOut.map((member_id) => ({ member_id })) },
    members: (query) => {
      const ids = query.calls.find((c) => c.method === "in" && c.args[0] === "id")?.args[1] as string[] | undefined;
      return { data: members.filter((m) => !ids || ids.includes(m.id)) };
    },
  });
}

const roster = (s: Setup, viewer: string | null = null, prickle = PRICKLE) =>
  loadPrickleRoster(setup(s) as never, prickle, viewer);

describe("loadPrickleRoster", () => {
  it("lists a member whose active commitment covers this prickle's slot and date", async () => {
    const result = await roster({ commitments: [commitment("m1")], members: [member("m1", "Fern Quillsby")] });
    expect(result).toEqual({
      entries: [{ memberId: "m1", name: "Fern Quillsby", reason: "committed", isYou: false, hiddenFromOthers: false }],
      total: 1,
    });
  });

  it("looks only at this prickle's type, weekday and time zone", async () => {
    const fake = setup({});
    await loadPrickleRoster(fake as never, PRICKLE, null);
    const slots = fake.queries.find((q) => q.table === "prickle_commitment_slots")!;
    expect(eqCall(slots, "type_id")).toBe("t1");
    expect(eqCall(slots, "day_of_week")).toBe(2);
    expect(eqCall(slots, "timezone")).toBe(SCHEDULE_TIMEZONE);
  });

  it("finds 'just this one' calendar items by the prickle's id, and weekly ones by its slot", async () => {
    const fake = setup({});
    await loadPrickleRoster(fake as never, PRICKLE, null);
    const items = fake.queries.filter((q) => q.table === "calendar_feed_items");
    const once = items.find((q) => eqCall(q, "kind") === "prickle")!;
    expect(eqCall(once, "prickle_id")).toBe("p1");
    expect(once.calls.some((c) => c.method === "eq" && c.args[0] === "start_time")).toBe(false);
    const weekly = items.find((q) => eqCall(q, "kind") === "slot")!;
    expect(eqCall(weekly, "type_id")).toBe("t1");
    expect(eqCall(weekly, "day_of_week")).toBe(2);
    expect(eqCall(weekly, "timezone")).toBe(SCHEDULE_TIMEZONE);
  });

  it.each([
    ["a cancelled commitment", { status: "cancelled" }],
    ["a finished one", { status: "completed" }],
    ["one that hasn't started yet", { start_date: "2026-10-27", end_date: "2026-11-23" }],
    ["one that ended before this prickle", { start_date: "2026-09-01", end_date: "2026-09-28" }],
    ["a different time of day", { time: "09:00:00" }],
  ])("leaves out %s", async (_label, over) => {
    const result = await roster({ commitments: [commitment("m1", over)], members: [member("m1", "Fern")] });
    expect(result).toEqual({ entries: [], total: 0 });
  });

  it("includes the first and last day of the commitment window", async () => {
    const result = await roster({
      commitments: [commitment("m1", { start_date: "2026-10-20" }), commitment("m2", { end_date: "2026-10-20" })],
      members: [member("m1", "Ana"), member("m2", "Bea")],
    });
    expect(result.entries.map((e) => e.memberId).sort()).toEqual(["m1", "m2"]);
  });

  it("lists members who added just this prickle, or its weekly slot, to their calendar", async () => {
    const result = await roster({
      once: ["m1"],
      weekly: [
        { member_id: "m2", start_time_local: "15:00:00" },
        { member_id: "m3", start_time_local: "09:00:00" },
      ],
      members: [member("m1", "Ana"), member("m2", "Bea"), member("m3", "Cy")],
    });
    expect(result.entries.map((e) => [e.memberId, e.reason])).toEqual([
      ["m1", "calendar"],
      ["m2", "calendar"],
    ]);
  });

  it("shows committing rather than adding to a calendar for someone who did both, once", async () => {
    const result = await roster({
      commitments: [commitment("m1")],
      once: ["m1"],
      members: [member("m1", "Ana")],
    });
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0].reason).toBe("committed");
  });

  it("uses a member's display name when they have one", async () => {
    const result = await roster({
      commitments: [commitment("m1")],
      members: [member("m1", "Fernanda Quillsby", { display_name: "Fern Quillsby" })],
    });
    expect(result.entries[0].name).toBe("Fern Quillsby");
  });

  it("leaves out former members", async () => {
    const result = await roster({
      commitments: [commitment("m1"), commitment("m2")],
      members: [member("m1", "Ana", { status: "cancelled" }), member("m2", "Bea")],
    });
    expect(result.entries.map((e) => e.memberId)).toEqual(["m2"]);
  });

  describe("opting out", () => {
    const s: Setup = {
      commitments: [commitment("m1"), commitment("m2")],
      members: [member("m1", "Ana"), member("m2", "Bea")],
      optedOut: ["m1"],
    };

    it("hides a member who opted out from everyone else", async () => {
      const result = await roster(s, "m2");
      expect(result.entries.map((e) => e.memberId)).toEqual(["m2"]);
      expect(result.total).toBe(1);
    });

    it("still shows them to themselves, marked as hidden", async () => {
      const result = await roster(s, "m1");
      expect(result.entries.map((e) => [e.memberId, e.isYou, e.hiddenFromOthers])).toEqual([
        ["m1", true, true],
        ["m2", false, false],
      ]);
    });

    it("hides them from a viewer with no member record too", async () => {
      expect((await roster(s, null)).entries.map((e) => e.memberId)).toEqual(["m2"]);
    });
  });

  it("puts you first, then those who committed, then the rest by name", async () => {
    const result = await roster(
      {
        commitments: [commitment("m3")],
        once: ["m1", "m2", "m4"],
        members: [member("m1", "Zed"), member("m2", "Amy"), member("m3", "Mo"), member("m4", "Bo")],
      },
      "m4"
    );
    expect(result.entries.map((e) => e.name)).toEqual(["Bo", "Mo", "Amy", "Zed"]);
  });

  it("cuts a long list off, keeping the total", async () => {
    const ids = Array.from({ length: ROSTER_LIMIT + 10 }, (_, i) => `m${String(i).padStart(3, "0")}`);
    const result = await roster({ once: ids, members: ids.map((id) => member(id, `Member ${id}`)) });
    expect(result.entries).toHaveLength(ROSTER_LIMIT);
    expect(result.total).toBe(ROSTER_LIMIT + 10);
  });

  it("has no slot-based sign-ups for a prickle with no type, only 'just this one' and the host", async () => {
    const fake = setup({
      commitments: [commitment("m1")],
      weekly: [{ member_id: "m2", start_time_local: "15:00:00" }],
      once: ["m3"],
      members: [member("m1", "Ana"), member("m2", "Bea"), member("m3", "Cy"), member("m4", "Di")],
    });
    const result = await loadPrickleRoster(fake as never, { ...PRICKLE, type_id: null, host_id: "m4" }, null);
    expect(result.entries.map((e) => [e.memberId, e.reason])).toEqual([
      ["m4", "host"],
      ["m3", "calendar"],
    ]);
    expect(fake.queries.some((q) => q.table === "prickle_commitment_slots")).toBe(false);
  });

  describe("the host", () => {
    const s: Setup = {
      commitments: [commitment("m2")],
      once: ["m3"],
      members: [member("m1", "Zoe Host"), member("m2", "Bea"), member("m3", "Cy")],
    };
    const withHost = { ...PRICKLE, host_id: "m1" };

    it("is listed first, then those who committed, then calendar adds", async () => {
      const result = await roster(s, null, withHost);
      expect(result.entries.map((e) => [e.name, e.reason])).toEqual([
        ["Zoe Host", "host"],
        ["Bea", "committed"],
        ["Cy", "calendar"],
      ]);
    });

    it("stays listed as host even after opting out, since the page names them anyway", async () => {
      const result = await roster({ ...s, optedOut: ["m1"] }, "m2", withHost);
      const host = result.entries.find((e) => e.memberId === "m1");
      expect(host).toMatchObject({ reason: "host", hiddenFromOthers: false });
    });

    it("shows hosting rather than committed or calendar for a host who also signed up", async () => {
      const result = await roster({ ...s, once: ["m1"], commitments: [commitment("m1")] }, null, withHost);
      expect(result.entries.filter((e) => e.memberId === "m1").map((e) => e.reason)).toEqual(["host"]);
    });

    it("isn't listed when they've left", async () => {
      const result = await roster({ ...s, members: [member("m1", "Zoe Host", { status: "cancelled" })] }, null, withHost);
      expect(result.entries).toEqual([]);
    });
  });
});
