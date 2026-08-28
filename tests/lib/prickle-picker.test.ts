import { describe, it, expect } from "vitest";
import {
  getPrickleRecommendations,
  seriesKeyFor,
  type CandidatePrickle,
  type HistoricalAttendanceRow,
  type HostVibeRow,
  type PickerAnswers,
  type PickerPrickleType,
  type PickerHost,
} from "@/lib/prickle-picker";

// ---------------------------------------------------------------------------
// Helpers — synthetic data only, no real member/host names.
// ---------------------------------------------------------------------------

// purpose + solo-task-friendliness are independent axes (see lib/prickle-picker.ts):
// Progress-like writing slots are open protected time; Sprint is writing-purpose
// but an active word-war, not friendly; Monthly Goal Review is work-purpose but a
// structured workshop, not friendly either.
const writingType: PickerPrickleType = {
  id: "type-writing",
  name: "Heads Down",
  purpose: "writing",
  soloTaskFriendly: true,
};
const sprintType: PickerPrickleType = {
  id: "type-sprint",
  name: "Sprint Prickle",
  purpose: "writing",
  soloTaskFriendly: false,
};
const workType: PickerPrickleType = {
  id: "type-work",
  name: "Monthly Goal Review",
  purpose: "work",
  soloTaskFriendly: false,
};
const openCoworkingType: PickerPrickleType = {
  id: "type-open-cowork",
  name: "Open Co-Working",
  purpose: "work",
  soloTaskFriendly: true,
};
const socialType: PickerPrickleType = {
  id: "type-social",
  name: "Open Table",
  purpose: "social",
  soloTaskFriendly: false,
};
const mixedType: PickerPrickleType = {
  id: "type-mixed",
  name: "Study Hall",
  purpose: "mixed",
  soloTaskFriendly: true,
};

const hostA: PickerHost = { id: "host-a", name: "Host A" };
const hostB: PickerHost = { id: "host-b", name: "Host B" };

const types = new Map([
  [writingType.id, writingType],
  [sprintType.id, sprintType],
  [workType.id, workType],
  [openCoworkingType.id, openCoworkingType],
  [socialType.id, socialType],
  [mixedType.id, mixedType],
]);
const hosts = new Map([
  [hostA.id, hostA],
  [hostB.id, hostB],
]);

function candidate(id: string, typeId: string, hostId: string, isoTime: string): CandidatePrickle {
  return { id, type_id: typeId, host_id: hostId, start_time: isoTime };
}

function attend(prickleId: string, memberId: string): HistoricalAttendanceRow {
  return { prickle_id: prickleId, member_id: memberId };
}

function baseAnswers(overrides: Partial<PickerAnswers> = {}): PickerAnswers {
  return {
    windowStart: "2026-01-01T00:00:00Z",
    windowEnd: "2026-01-31T23:59:59Z",
    timeOfDay: "any",
    vibe: "any",
    purpose: "any",
    withMemberIds: [],
    timezone: "America/New_York",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Purpose hard filter
// ---------------------------------------------------------------------------

describe("purpose filter", () => {
  it("a 'work' request is governed entirely by solo-task-friendliness, not the purpose label", () => {
    const candidates = [
      candidate("p1", writingType.id, hostA.id, "2026-01-05T15:00:00Z"), // Heads Down: writing, friendly
      candidate("p2", sprintType.id, hostA.id, "2026-01-06T15:00:00Z"), // Sprint: writing, NOT friendly
      candidate("p3", workType.id, hostA.id, "2026-01-07T15:00:00Z"), // Monthly Goal Review: work, NOT friendly
    ];
    const result = getPrickleRecommendations(
      candidates,
      types,
      hosts,
      [],
      [],
      [],
      baseAnswers({ purpose: "work" })
    );
    expect(result).toHaveLength(1);
    expect(result[0].typeId).toBe(writingType.id);
  });

  it("ranks an on-topic solo-friendly work session above a generic solo-friendly writing session", () => {
    const candidates = [
      candidate("p1", writingType.id, hostA.id, "2026-01-05T15:00:00Z"),
      candidate("p2", openCoworkingType.id, hostB.id, "2026-01-06T15:00:00Z"),
    ];
    const result = getPrickleRecommendations(
      candidates,
      types,
      hosts,
      [],
      [],
      [],
      baseAnswers({ purpose: "work" })
    );
    expect(result).toHaveLength(2);
    expect(result[0].typeId).toBe(openCoworkingType.id);
    expect(result[1].typeId).toBe(writingType.id);
  });

  it("does not extend 'work' matching to social or non-friendly writing/work types", () => {
    const candidates = [
      candidate("p1", socialType.id, hostA.id, "2026-01-05T15:00:00Z"),
      candidate("p2", sprintType.id, hostA.id, "2026-01-06T15:00:00Z"),
      candidate("p3", workType.id, hostA.id, "2026-01-07T15:00:00Z"),
    ];
    const result = getPrickleRecommendations(
      candidates,
      types,
      hosts,
      [],
      [],
      [],
      baseAnswers({ purpose: "work" })
    );
    expect(result).toHaveLength(0);
  });

  it("does not extend solo-task-friendliness leniency to 'social' or 'writing' requests", () => {
    const candidates = [candidate("p1", writingType.id, hostA.id, "2026-01-05T15:00:00Z")];
    const result = getPrickleRecommendations(
      candidates,
      types,
      hosts,
      [],
      [],
      [],
      baseAnswers({ purpose: "social" })
    );
    expect(result).toHaveLength(0);
  });

  it("always includes 'mixed' purpose types for non-work requests, regardless of the requested purpose", () => {
    const candidates = [candidate("p1", mixedType.id, hostA.id, "2026-01-05T15:00:00Z")];
    const result = getPrickleRecommendations(
      candidates,
      types,
      hosts,
      [],
      [],
      [],
      baseAnswers({ purpose: "social" })
    );
    expect(result).toHaveLength(1);
  });

  it("does not extend the 'mixed' pass-through to 'work' requests unless also solo-task-friendly", () => {
    const busyMixedType: PickerPrickleType = {
      id: "type-mixed-busy",
      name: "Busy Mixed Event",
      purpose: "mixed",
      soloTaskFriendly: false,
    };
    const typesWithExtra = new Map(types).set(busyMixedType.id, busyMixedType);
    const candidates = [candidate("p1", busyMixedType.id, hostA.id, "2026-01-05T15:00:00Z")];
    const result = getPrickleRecommendations(
      candidates,
      typesWithExtra,
      hosts,
      [],
      [],
      [],
      baseAnswers({ purpose: "work" })
    );
    expect(result).toHaveLength(0);
  });

  it("'any' purpose preference includes everything", () => {
    const candidates = [
      candidate("p1", writingType.id, hostA.id, "2026-01-05T15:00:00Z"),
      candidate("p2", workType.id, hostA.id, "2026-01-06T15:00:00Z"),
    ];
    const result = getPrickleRecommendations(candidates, types, hosts, [], [], [], baseAnswers());
    expect(result).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// Vibe: tagged vs inferred vs unknown
// ---------------------------------------------------------------------------

describe("vibe resolution", () => {
  it("uses the explicit host tag when present", () => {
    const candidates = [candidate("p1", writingType.id, hostA.id, "2026-01-05T15:00:00Z")];
    const vibes: HostVibeRow[] = [
      { type_id: writingType.id, host_id: hostA.id, vibe: "chatty", notes: "goofy crew" },
    ];
    const result = getPrickleRecommendations(candidates, types, hosts, [], [], vibes, baseAnswers());
    expect(result[0].vibe).toBe("chatty");
    expect(result[0].vibeSource).toBe("tagged");
    expect(result[0].vibeNotes).toBe("goofy crew");
  });

  it("infers a low-confidence vibe from average attendance when untagged", () => {
    const candidates = [candidate("p1", writingType.id, hostA.id, "2026-01-05T15:00:00Z")];
    const history = [
      candidate("h1", writingType.id, hostA.id, "2025-12-01T15:00:00Z"),
      candidate("h2", writingType.id, hostA.id, "2025-12-08T15:00:00Z"),
    ];
    // 10 attendees average -> above the "chatty" threshold
    const attendance = [
      attend("h1", "m1"),
      attend("h1", "m2"),
      attend("h1", "m3"),
      attend("h1", "m4"),
      attend("h1", "m5"),
      attend("h1", "m6"),
      attend("h1", "m7"),
      attend("h1", "m8"),
      attend("h1", "m9"),
      attend("h1", "m10"),
      attend("h2", "m1"),
      attend("h2", "m2"),
      attend("h2", "m3"),
      attend("h2", "m4"),
      attend("h2", "m5"),
      attend("h2", "m6"),
      attend("h2", "m7"),
      attend("h2", "m8"),
      attend("h2", "m9"),
      attend("h2", "m10"),
    ];
    const result = getPrickleRecommendations(candidates, types, hosts, history, attendance, [], baseAnswers());
    expect(result[0].vibe).toBe("chatty");
    expect(result[0].vibeSource).toBe("inferred");
  });

  it("reports 'unknown' vibe with no history and no tag, without excluding the series", () => {
    const candidates = [candidate("p1", writingType.id, hostA.id, "2026-01-05T15:00:00Z")];
    const result = getPrickleRecommendations(candidates, types, hosts, [], [], [], baseAnswers());
    expect(result).toHaveLength(1);
    expect(result[0].vibe).toBe("unknown");
    expect(result[0].vibeSource).toBe("unknown");
  });
});

// ---------------------------------------------------------------------------
// Co-attendance ranking
// ---------------------------------------------------------------------------

describe("co-attendance ranking", () => {
  it("ranks the series where requested members attend together most often first", () => {
    const candidates = [
      candidate("p1", writingType.id, hostA.id, "2026-01-05T15:00:00Z"),
      candidate("p2", writingType.id, hostB.id, "2026-01-06T15:00:00Z"),
    ];
    const history = [
      candidate("hA1", writingType.id, hostA.id, "2025-12-01T15:00:00Z"),
      candidate("hA2", writingType.id, hostA.id, "2025-12-08T15:00:00Z"),
      candidate("hB1", writingType.id, hostB.id, "2025-12-01T15:00:00Z"),
    ];
    // Sue & Jane attend host A's series together every time; never both at host B's.
    const attendance = [
      attend("hA1", "sue"),
      attend("hA1", "jane"),
      attend("hA2", "sue"),
      attend("hA2", "jane"),
      attend("hB1", "sue"),
    ];
    const result = getPrickleRecommendations(
      candidates,
      types,
      hosts,
      history,
      attendance,
      [],
      baseAnswers({ withMemberIds: ["sue", "jane"] })
    );
    expect(result[0].hostId).toBe(hostA.id);
    expect(result[0].coAttendanceRate).toBe(1);
    expect(result[1].coAttendanceRate).toBe(0);
  });

  it("gives brand-new series with no history a neutral score instead of excluding them", () => {
    const candidates = [candidate("p1", writingType.id, hostA.id, "2026-01-05T15:00:00Z")];
    const result = getPrickleRecommendations(
      candidates,
      types,
      hosts,
      [],
      [],
      [],
      baseAnswers({ withMemberIds: ["sue"] })
    );
    expect(result).toHaveLength(1);
    expect(result[0].coAttendanceRate).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Time-of-day filtering
// ---------------------------------------------------------------------------

describe("time-of-day filtering", () => {
  it("keeps only evening candidates when 'evening' is requested, in the given timezone", () => {
    const candidates = [
      // 10:00 ET = afternoon-ish morning depending on DST, use explicit UTC offsets for clarity
      candidate("morning", writingType.id, hostA.id, "2026-01-05T15:00:00Z"), // 10:00 ET (EST, UTC-5)
      candidate("evening", writingType.id, hostA.id, "2026-01-05T23:30:00Z"), // 18:30 ET
    ];
    const result = getPrickleRecommendations(
      candidates,
      types,
      hosts,
      [],
      [],
      [],
      baseAnswers({ timeOfDay: "evening", timezone: "America/New_York" })
    );
    expect(result).toHaveLength(1);
    expect(result[0].occurrences[0].id).toBe("evening");
  });

  it("respects a different timezone for the same instant", () => {
    // 23:30 UTC is evening in New York (18:30) but late-night in a UTC+? irrelevant here —
    // instead verify a fixed UTC evening moves buckets in a different zone.
    const candidates = [candidate("p1", writingType.id, hostA.id, "2026-01-05T23:30:00Z")];
    const inNY = getPrickleRecommendations(
      candidates,
      types,
      hosts,
      [],
      [],
      [],
      baseAnswers({ timeOfDay: "evening", timezone: "America/New_York" })
    );
    const inTokyo = getPrickleRecommendations(
      candidates,
      types,
      hosts,
      [],
      [],
      [],
      baseAnswers({ timeOfDay: "evening", timezone: "Asia/Tokyo" })
    );
    expect(inNY).toHaveLength(1); // 18:30 ET -> evening
    expect(inTokyo).toHaveLength(0); // 08:30 JST -> morning, not evening
  });

  it("'any' time of day includes candidates at every hour", () => {
    const candidates = [
      candidate("p1", writingType.id, hostA.id, "2026-01-05T05:00:00Z"),
      candidate("p2", writingType.id, hostA.id, "2026-01-05T23:30:00Z"),
    ];
    const result = getPrickleRecommendations(candidates, types, hosts, [], [], [], baseAnswers());
    // both fall in the same series (same type+host), so they dedupe into one recommendation
    expect(result).toHaveLength(1);
    expect(result[0].occurrences).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// Dedupe per series
// ---------------------------------------------------------------------------

describe("dedupe per series", () => {
  it("collapses multiple upcoming occurrences of the same (type, host) into one recommendation", () => {
    const candidates = [
      candidate("p1", writingType.id, hostA.id, "2026-01-05T15:00:00Z"),
      candidate("p2", writingType.id, hostA.id, "2026-01-12T15:00:00Z"),
      candidate("p3", writingType.id, hostA.id, "2026-01-19T15:00:00Z"),
    ];
    const result = getPrickleRecommendations(candidates, types, hosts, [], [], [], baseAnswers());
    expect(result).toHaveLength(1);
    expect(result[0].occurrences.map((o) => o.id)).toEqual(["p1", "p2", "p3"]);
  });

  it("caps occurrences shown per series at 3, soonest first", () => {
    const candidates = [
      candidate("p1", writingType.id, hostA.id, "2026-01-26T15:00:00Z"),
      candidate("p2", writingType.id, hostA.id, "2026-01-05T15:00:00Z"),
      candidate("p3", writingType.id, hostA.id, "2026-01-12T15:00:00Z"),
      candidate("p4", writingType.id, hostA.id, "2026-01-19T15:00:00Z"),
    ];
    const result = getPrickleRecommendations(candidates, types, hosts, [], [], [], baseAnswers());
    expect(result[0].occurrences).toHaveLength(3);
    expect(result[0].occurrences.map((o) => o.id)).toEqual(["p2", "p3", "p4"]);
  });

  it("keeps different hosts of the same type as separate series", () => {
    const candidates = [
      candidate("p1", writingType.id, hostA.id, "2026-01-05T15:00:00Z"),
      candidate("p2", writingType.id, hostB.id, "2026-01-06T15:00:00Z"),
    ];
    const result = getPrickleRecommendations(candidates, types, hosts, [], [], [], baseAnswers());
    expect(result).toHaveLength(2);
  });
});

describe("seriesKeyFor", () => {
  it("falls back to placeholder segments for null type/host", () => {
    expect(seriesKeyFor(null, null)).toBe("notype:nohost");
    expect(seriesKeyFor("t1", null)).toBe("t1:nohost");
  });
});

// ---------------------------------------------------------------------------
// Window filtering
// ---------------------------------------------------------------------------

describe("window filtering", () => {
  it("excludes candidates outside the requested date window", () => {
    const candidates = [
      candidate("in", writingType.id, hostA.id, "2026-01-15T15:00:00Z"),
      candidate("out", writingType.id, hostB.id, "2026-02-15T15:00:00Z"),
    ];
    const result = getPrickleRecommendations(
      candidates,
      types,
      hosts,
      [],
      [],
      [],
      baseAnswers({ windowStart: "2026-01-01T00:00:00Z", windowEnd: "2026-01-31T23:59:59Z" })
    );
    expect(result).toHaveLength(1);
    expect(result[0].occurrences[0].id).toBe("in");
  });
});
