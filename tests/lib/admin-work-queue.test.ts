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

});

describe("buildHedgieversaryQueue for a returning member", () => {
  // Joined 2023-08-29, left after a month and came back 2026-07-01 (a 33-month gap, stored as
  // inactive_periods): the count restarts, so the 6-month mark is 2027-01-01.
  const returning: MemberInput = {
    id: "m3",
    name: "Ada Example",
    first_joined_at: "2023-08-29",
    total_active_months: 3,
    inactive_periods: [{ start: "2023-10-01", end: "2026-07-01" }],
  };

  it("counts from the return, keys the occurrence by the restart date and says second time around", () => {
    const result = buildHedgieversaryQueue([returning], new Map(), NO_COMPLETIONS, NOW, 150, 0);
    expect(result).toEqual([
      {
        queueType: "hedgieversary",
        memberId: "m3",
        memberName: "Ada Example",
        occurrenceKey: "2026-07-01:6",
        deadline: "2027-01-01",
        label: "6-Month (second time around)",
      },
    ]);
  });

  it("produces none of the first stint's milestones", () => {
    const result = buildHedgieversaryQueue([returning], new Map(), NO_COMPLETIONS, NOW, 150, 1000);
    expect(result.map((r) => r.deadline)).toEqual(["2027-01-01"]);
  });

  it("is not suppressed by a completed 6-month from the first stint", () => {
    const completed = completedMap([completionKey("hedgieversary", "m3", "6")]);
    const result = buildHedgieversaryQueue([returning], new Map(), completed, NOW, 150, 0);
    expect(result.map((r) => r.occurrenceKey)).toEqual(["2026-07-01:6"]);
  });

  it("is suppressed by its own completion", () => {
    const completed = completedMap([completionKey("hedgieversary", "m3", "2026-07-01:6")]);
    expect(buildHedgieversaryQueue([returning], new Map(), completed, NOW, 150, 0)).toEqual([]);
  });

  it("ignores a hiatus from before the gap, and treats a hiatus inside the gap as the hiatus (no return)", () => {
    const hiatus = new Map<string, HiatusWindow[]>([["m3", [{ startsAt: "2023-09-01", endsAt: "2023-09-20" }]]]);
    const result = buildHedgieversaryQueue([returning], hiatus, NO_COMPLETIONS, NOW, 150, 0);
    expect(result.map((r) => r.deadline)).toEqual(["2027-01-01"]);
  });

  it("a gap that coincides with a recorded hiatus is not a return: plain keys, hiatus shift only", () => {
    const member: MemberInput = {
      id: "m7",
      name: "Ada Example",
      first_joined_at: "2023-08-29",
      total_active_months: 36,
      inactive_periods: [{ start: "2025-01-01", end: "2025-05-01" }],
    };
    const hiatus = new Map<string, HiatusWindow[]>([["m7", [{ startsAt: "2025-01-01", endsAt: "2025-05-01" }]]]);
    const result = buildHedgieversaryQueue([member], hiatus, NO_COMPLETIONS, NOW, 365, 0);
    // 36 months is 2026-08-29 + 4 hiatus months (2025-01-01 to 2025-05-01, before the 3-year mark)
    expect(result.map((r) => [r.occurrenceKey, r.deadline])).toEqual([["36", "2026-12-29"]]);
  });

  it("a gap under 60 days is a billing blip: same dates, plain keys", () => {
    const blip: MemberInput = { id: "m4", name: "Ada Example", first_joined_at: "2023-08-29", total_active_months: 36, inactive_periods: [{ start: "2026-01-01", end: "2026-02-15" }] };
    expect(buildHedgieversaryQueue([blip], new Map(), NO_COMPLETIONS, NOW)).toEqual([
      { queueType: "hedgieversary", memberId: "m4", memberName: "Ada Example", occurrenceKey: "36", deadline: "2026-08-29", label: "3-Year" },
    ]);
  });

  it("falls back to hiatus windows alone when gaps were never computed (null)", () => {
    const members: MemberInput[] = [
      { id: "m6", name: "Ada Example", first_joined_at: "2023-08-29", total_active_months: 36, inactive_periods: null },
    ];
    expect(buildHedgieversaryQueue(members, new Map(), NO_COMPLETIONS, NOW).map((r) => r.occurrenceKey)).toEqual(["36"]);
  });

  it("a hiatus after the return shifts the later milestones", () => {
    const hiatus = new Map<string, HiatusWindow[]>([["m3", [{ startsAt: "2026-08-01", endsAt: "2026-10-01" }]]]);
    // on hiatus at NOW? 2026-09-03 is inside it: nothing
    expect(buildHedgieversaryQueue([returning], hiatus, NO_COMPLETIONS, NOW, 300, 0)).toEqual([]);
    const later = new Date("2026-10-15T00:00:00Z");
    const result = buildHedgieversaryQueue([returning], hiatus, NO_COMPLETIONS, later, 150, 0);
    expect(result.map((r) => r.deadline)).toEqual(["2027-03-01"]); // 2027-01-01 + the 2-month hiatus
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
