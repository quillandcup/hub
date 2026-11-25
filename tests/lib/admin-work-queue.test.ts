import { describe, it, expect } from "vitest";
import {
  buildWelcomeBackQueue,
  buildHedgieversaryQueue,
  buildHiatusNudgeQueue,
  buildBigSisterQueue,
  bigSisterMatchKey,
  completionKey,
  type HiatusInput,
  type MemberInput,
  type CompletionLookup,
} from "@/lib/admin-work-queue";
import type { HiatusWindow } from "@/lib/member-tenure";

const NOW = new Date("2026-09-03T00:00:00Z");

function membersMap(members: { id: string; name: string }[]) {
  return new Map(members.map((m) => [m.id, { name: m.name }]));
}

// Builds a CompletionLookup from plain "completed" keys — the common case
// used by most tests below, where the exact status doesn't matter beyond
// "this occurrence is suppressed."
function completedMap(keys: string[]): CompletionLookup {
  return new Map(keys.map((key) => [key, { status: "completed" as const, postponedUntil: null }]));
}

const NO_COMPLETIONS: CompletionLookup = new Map();

describe("buildWelcomeBackQueue", () => {
  const membersById = membersMap([
    { id: "m1", name: "Jane Doe" },
    { id: "m2", name: "Sam Lee" },
  ]);

  it("surfaces a hiatus that ended within the lookback window", () => {
    const hiatus: HiatusInput[] = [{ id: "h1", member_id: "m1", start_date: "2026-07-01", end_date: "2026-09-01" }];
    const result = buildWelcomeBackQueue(hiatus, membersById, NO_COMPLETIONS, NOW);
    expect(result).toEqual([
      { queueType: "welcome_back", memberId: "m1", memberName: "Jane Doe", occurrenceKey: "h1", deadline: "2026-09-01", label: "Hiatus ended" },
    ]);
  });

  it("excludes an indefinite hiatus (no end date)", () => {
    const hiatus: HiatusInput[] = [{ id: "h1", member_id: "m1", start_date: "2026-07-01", end_date: null }];
    expect(buildWelcomeBackQueue(hiatus, membersById, NO_COMPLETIONS, NOW)).toEqual([]);
  });

  it("excludes an already-completed item", () => {
    const hiatus: HiatusInput[] = [{ id: "h1", member_id: "m1", start_date: "2026-07-01", end_date: "2026-09-01" }];
    const completed = completedMap([completionKey("welcome_back", "m1", "h1")]);
    expect(buildWelcomeBackQueue(hiatus, membersById, completed, NOW)).toEqual([]);
  });

  it("excludes a hiatus that ended long before the lookback window", () => {
    const hiatus: HiatusInput[] = [{ id: "h1", member_id: "m1", start_date: "2025-01-01", end_date: "2025-02-01" }];
    expect(buildWelcomeBackQueue(hiatus, membersById, NO_COMPLETIONS, NOW)).toEqual([]);
  });

  it("includes an upcoming end date within the lookahead window", () => {
    const hiatus: HiatusInput[] = [{ id: "h1", member_id: "m1", start_date: "2026-08-01", end_date: "2026-09-10" }];
    const result = buildWelcomeBackQueue(hiatus, membersById, NO_COMPLETIONS, NOW);
    expect(result).toHaveLength(1);
  });

  it("sorts multiple items by deadline ascending", () => {
    const hiatus: HiatusInput[] = [
      { id: "h1", member_id: "m1", start_date: "2026-07-01", end_date: "2026-09-01" },
      { id: "h2", member_id: "m2", start_date: "2026-06-01", end_date: "2026-08-28" },
    ];
    const result = buildWelcomeBackQueue(hiatus, membersById, NO_COMPLETIONS, NOW);
    expect(result.map((r) => r.memberId)).toEqual(["m2", "m1"]);
  });
});

describe("work queue lookahead: through the end of next month (Eastern)", () => {
  const membersById = membersMap([{ id: "m1", name: "Jane Doe" }]);
  const returning = (end_date: string): HiatusInput[] => [{ id: "h1", member_id: "m1", start_date: "2026-08-01", end_date }];

  it("shows returns in mid December when planning on Nov 25", () => {
    const now = new Date("2026-11-25T15:00:00Z");
    for (const end of ["2026-12-13", "2026-12-18", "2026-12-31"]) {
      expect(buildWelcomeBackQueue(returning(end), membersById, NO_COMPLETIONS, now)).toHaveLength(1);
    }
  });

  it("stops after the last day of next month", () => {
    const now = new Date("2026-11-25T15:00:00Z");
    expect(buildWelcomeBackQueue(returning("2027-01-01"), membersById, NO_COMPLETIONS, now)).toEqual([]);
  });

  it("uses the Eastern month, not UTC: 9pm Eastern on Nov 30 is already Dec 1 in UTC", () => {
    const now = new Date("2026-12-01T02:00:00Z");
    expect(buildWelcomeBackQueue(returning("2026-12-31"), membersById, NO_COMPLETIONS, now)).toHaveLength(1);
    expect(buildWelcomeBackQueue(returning("2027-01-01"), membersById, NO_COMPLETIONS, now)).toEqual([]);
  });

  it("handles a year rollover and a short next month", () => {
    expect(buildWelcomeBackQueue(returning("2027-02-28"), membersById, NO_COMPLETIONS, new Date("2027-01-10T15:00:00Z"))).toHaveLength(1);
    expect(buildWelcomeBackQueue(returning("2027-03-01"), membersById, NO_COMPLETIONS, new Date("2027-01-10T15:00:00Z"))).toEqual([]);
  });

  it("also applies to hiatus nudges", () => {
    const hiatus: HiatusInput[] = [{ id: "h1", member_id: "m1", start_date: "2026-11-01", end_date: "2027-01-01" }];
    const now = new Date("2026-11-25T15:00:00Z");
    expect(buildHiatusNudgeQueue(hiatus, membersById, NO_COMPLETIONS, now).length).toBeGreaterThan(0);
  });
});

describe("buildHedgieversaryQueue", () => {
  // 3-year (36mo) milestone lands 2026-08-29 — 5 days before NOW, within the 14-day lookback.
  // total_active_months matches elapsed time exactly (continuously active,
  // no cancel/resubscribe gaps), so it doesn't shift the milestone date.
  const members: MemberInput[] = [
    { id: "m1", name: "Julie Hykes", first_joined_at: "2023-08-29", total_active_months: 36 },
  ];

  it("surfaces a reached, not-yet-completed milestone", () => {
    const hiatusWindows = new Map<string, HiatusWindow[]>();
    const result = buildHedgieversaryQueue(members, hiatusWindows, NO_COMPLETIONS, NOW);
    expect(result).toEqual([
      { queueType: "hedgieversary", memberId: "m1", memberName: "Julie Hykes", occurrenceKey: "36", deadline: "2026-08-29", label: "3-Year" },
    ]);
  });

  it("excludes a milestone once its occurrence key is marked completed", () => {
    const hiatusWindows = new Map<string, HiatusWindow[]>();
    const completed = completedMap([completionKey("hedgieversary", "m1", "36")]);
    expect(buildHedgieversaryQueue(members, hiatusWindows, completed, NOW)).toEqual([]);
  });

  it("excludes a milestone marked opted_out — permanent, unlike postponed", () => {
    const hiatusWindows = new Map<string, HiatusWindow[]>();
    const completed: CompletionLookup = new Map([
      [completionKey("hedgieversary", "m1", "36"), { status: "opted_out", postponedUntil: null }],
    ]);
    expect(buildHedgieversaryQueue(members, hiatusWindows, completed, NOW)).toEqual([]);
  });

  it("excludes a milestone postponed to a future date", () => {
    const hiatusWindows = new Map<string, HiatusWindow[]>();
    const completed: CompletionLookup = new Map([
      [completionKey("hedgieversary", "m1", "36"), { status: "postponed", postponedUntil: "2026-09-10" }],
    ]);
    expect(buildHedgieversaryQueue(members, hiatusWindows, completed, NOW)).toEqual([]);
  });

  it("resurfaces a postponed milestone once postponedUntil has passed", () => {
    const hiatusWindows = new Map<string, HiatusWindow[]>();
    const completed: CompletionLookup = new Map([
      [completionKey("hedgieversary", "m1", "36"), { status: "postponed", postponedUntil: "2026-09-01" }],
    ]);
    const result = buildHedgieversaryQueue(members, hiatusWindows, completed, NOW);
    expect(result).toEqual([
      { queueType: "hedgieversary", memberId: "m1", memberName: "Julie Hykes", occurrenceKey: "36", deadline: "2026-08-29", label: "3-Year" },
    ]);
  });

  it("skips members with no first_joined_at", () => {
    const noJoinDate: MemberInput[] = [
      { id: "m2", name: "Lead Person", first_joined_at: null, total_active_months: 0 },
    ];
    expect(buildHedgieversaryQueue(noJoinDate, new Map(), NO_COMPLETIONS, NOW)).toEqual([]);
  });

  it("excludes a member on an indefinite hiatus", () => {
    const hiatusWindows = new Map<string, HiatusWindow[]>([
      ["m1", [{ startsAt: "2026-08-01", endsAt: null }]],
    ]);
    expect(buildHedgieversaryQueue(members, hiatusWindows, NO_COMPLETIONS, NOW)).toEqual([]);
  });

  it("excludes a member on a currently-active hiatus even when its return date is already known", () => {
    // Regression: a hiatus with a planned end date used to only shift the
    // milestone date forward, not suppress it -- so someone mid-hiatus could
    // still show a "next milestone" date that fell inside the hiatus itself
    // (a membership milestone while not currently a member). Any hiatus
    // covering NOW must suppress the queue entry, known end date or not.
    const hiatusWindows = new Map<string, HiatusWindow[]>([
      ["m1", [{ startsAt: "2026-08-01", endsAt: "2026-10-01" }]],
    ]);
    expect(buildHedgieversaryQueue(members, hiatusWindows, NO_COMPLETIONS, NOW)).toEqual([]);
  });

  it("pushes the milestone date out for cancel/resubscribe gap time, not just hiatus", () => {
    // Joined 3 years ago, cancelled after a month and only came back in July
    // 2026 (a dated 33-month gap, stored as inactive_periods) — the 6-month
    // milestone shouldn't be "reached" yet; it lands 6 + 33 months after the
    // first join, once she has accrued 6 real active months. (Before the
    // dated gaps, the gap was guessed from total_active_months.)
    const gappyMember: MemberInput[] = [
      {
        id: "m3",
        name: "Stephanie Johnson",
        first_joined_at: "2023-08-29",
        total_active_months: 3,
        inactive_periods: [{ start: "2023-10-01", end: "2026-07-01" }],
      },
    ];
    const result = buildHedgieversaryQueue(gappyMember, new Map(), NO_COMPLETIONS, NOW, 120, 0);
    expect(result).toEqual([
      { queueType: "hedgieversary", memberId: "m3", memberName: "Stephanie Johnson", occurrenceKey: "6", deadline: "2026-11-29", label: "6-Month" },
    ]);
  });
});

describe("buildHedgieversaryQueue with stored gaps", () => {
  it("does not move a milestone reached before a later gap", () => {
    // The 3-year mark (2026-08-29) was reached before the gap began, so the gap can't move it.
    const result = buildHedgieversaryQueue(
      [{ id: "m4", name: "Ada Example", first_joined_at: "2023-08-29", total_active_months: 36, inactive_periods: [{ start: "2026-08-30", end: "2026-12-30" }] }],
      new Map(),
      NO_COMPLETIONS,
      NOW
    );
    expect(result.map((r) => r.deadline)).toEqual(["2026-08-29"]);
  });

  it("merges a stored gap with an overlapping hiatus window, counting the time once", () => {
    const members: MemberInput[] = [
      { id: "m5", name: "Ada Example", first_joined_at: "2023-08-29", total_active_months: 3, inactive_periods: [{ start: "2023-10-01", end: "2025-01-01" }] },
    ];
    const hiatus = new Map<string, HiatusWindow[]>([["m5", [{ startsAt: "2024-01-01", endsAt: "2026-07-01" }]]]);
    const result = buildHedgieversaryQueue(members, hiatus, NO_COMPLETIONS, NOW, 120, 0);
    // Oct 1 2023 to Jul 1 2026 is one 33-month period, not 15 + 30.
    expect(result.map((r) => r.deadline)).toEqual(["2026-11-29"]);
  });

  it("falls back to hiatus windows alone when gaps were never computed (null)", () => {
    const members: MemberInput[] = [
      { id: "m6", name: "Ada Example", first_joined_at: "2023-08-29", total_active_months: 36, inactive_periods: null },
    ];
    expect(buildHedgieversaryQueue(members, new Map(), NO_COMPLETIONS, NOW).map((r) => r.deadline)).toEqual(["2026-08-29"]);
  });
});

describe("buildHiatusNudgeQueue", () => {
  const membersById = membersMap([{ id: "m1", name: "Pat Kim" }]);

  it("surfaces a reached touchpoint not yet completed, with the expected return date", () => {
    // 56-day hiatus starting 2026-08-06 -> 25/50/75% marks on 08-20/09-03/09-17,
    // landing exactly on the [now-14d, now+14d] window's edges and center.
    const hiatus: HiatusInput[] = [{ id: "h1", member_id: "m1", start_date: "2026-08-06", end_date: "2026-10-01" }];
    const result = buildHiatusNudgeQueue(hiatus, membersById, NO_COMPLETIONS, NOW);
    expect(result.map((r) => r.label)).toEqual(["25% mark", "50% mark", "75% mark"]);
    expect(result.every((r) => r.memberId === "m1")).toBe(true);
    expect(result.every((r) => r.expectedReturnDate === "2026-10-01")).toBe(true);
  });

  it("excludes a completed touchpoint but keeps the others", () => {
    const hiatus: HiatusInput[] = [{ id: "h1", member_id: "m1", start_date: "2026-08-06", end_date: "2026-10-01" }];
    const completed = completedMap([completionKey("hiatus_nudge", "m1", "h1:50")]);
    const result = buildHiatusNudgeQueue(hiatus, membersById, completed, NOW);
    expect(result.map((r) => r.label)).toEqual(["25% mark", "75% mark"]);
  });

  it("excludes an indefinite hiatus (no touchpoints computable)", () => {
    const hiatus: HiatusInput[] = [{ id: "h1", member_id: "m1", start_date: "2026-06-01", end_date: null }];
    expect(buildHiatusNudgeQueue(hiatus, membersById, NO_COMPLETIONS, NOW)).toEqual([]);
  });

  it("uses hiatus-id-scoped occurrence keys so two hiatuses don't collide", () => {
    const hiatus: HiatusInput[] = [
      { id: "h1", member_id: "m1", start_date: "2026-08-06", end_date: "2026-10-01" },
      { id: "h2", member_id: "m1", start_date: "2026-08-06", end_date: "2026-10-01" },
    ];
    const result = buildHiatusNudgeQueue(hiatus, membersById, NO_COMPLETIONS, NOW);
    const keys = new Set(result.map((r) => r.occurrenceKey));
    expect(keys.size).toBe(6); // 3 marks x 2 distinct hiatus ids, no collisions
  });
});

describe("buildBigSisterQueue", () => {
  const now = new Date("2026-06-10T12:00:00Z");
  const alice = { memberId: "m-alice", memberName: "Alice", startedOn: "2026-06-08" };
  const bea = { memberId: "m-bea", memberName: "Bea", startedOn: "2026-06-09" };

  it("lists new members without a big sister, oldest first", () => {
    const items = buildBigSisterQueue([bea, alice], new Set(), new Map(), now);
    expect(items.map((i) => i.memberName)).toEqual(["Alice", "Bea"]);
    expect(items[0]).toMatchObject({
      queueType: "big_sister",
      deadline: "2026-06-08",
      occurrenceKey: "2026-06-08",
      label: "Needs a big sister",
    });
  });

  it("drops a member once matched", () => {
    expect(buildBigSisterQueue([alice, bea], new Set([bigSisterMatchKey("m-alice", "2026-06-08")]), new Map(), now).map((i) => i.memberName)).toEqual([
      "Bea",
    ]);
  });

  it("lists a returning member again for a later arrival, even if their earlier one was matched", () => {
    const earlier = new Set([bigSisterMatchKey("m-alice", "2026-01-05")]);
    expect(buildBigSisterQueue([alice], earlier, new Map(), now).map((i) => i.memberName)).toEqual(["Alice"]);
  });

  it("drops a member whose item was marked done", () => {
    const completed = new Map([[completionKey("big_sister", "m-alice", "2026-06-08"), { status: "completed" as const, postponedUntil: null }]]);
    expect(buildBigSisterQueue([alice], new Set(), completed, now)).toEqual([]);
  });

  it("stops listing a member after the lookback window", () => {
    expect(buildBigSisterQueue([{ ...alice, startedOn: "2026-05-01" }], new Set(), new Map(), now)).toEqual([]);
  });
});
