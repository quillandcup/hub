import { describe, it, expect } from "vitest";
import {
  buildWelcomeBackQueue,
  buildHedgieversaryQueue,
  buildHiatusNudgeQueue,
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
  const members: MemberInput[] = [{ id: "m1", name: "Julie Hykes", first_joined_at: "2023-08-29" }];

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
    const noJoinDate: MemberInput[] = [{ id: "m2", name: "Lead Person", first_joined_at: null }];
    expect(buildHedgieversaryQueue(noJoinDate, new Map(), NO_COMPLETIONS, NOW)).toEqual([]);
  });

  it("excludes a member on an indefinite hiatus", () => {
    const hiatusWindows = new Map<string, HiatusWindow[]>([
      ["m1", [{ startsAt: "2026-08-01", endsAt: null }]],
    ]);
    expect(buildHedgieversaryQueue(members, hiatusWindows, NO_COMPLETIONS, NOW)).toEqual([]);
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
