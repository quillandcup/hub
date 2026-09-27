import { describe, it, expect } from "vitest";
import {
  assignOccurrencePrickles,
  buildAttendedSet,
  buildSlotOptions,
  commitmentEndDate,
  commitmentsFetchWindow,
  computeCommitmentProgress,
  defaultCommitmentStartDate,
  effectiveCommitmentStatus,
  expectedOccurrenceStart,
  findOverlappingCommitment,
  firstOccurrenceDate,
  formatCommitmentTitle,
  formatSlotLabel,
  prickleMatchesSlot,
  slotOccurrenceDates,
  slotTimeForInstant,
  validateCommitmentInput,
  windowsOverlap,
  type Commitment,
  type CommitmentSlot,
  type SlotPrickle,
} from "@/lib/commitments";

const TYPE = "type-progress";
const OTHER_TYPE = "type-other";
const ET = "America/New_York";

// 2026-09-28 is a Monday. US DST ends 2026-11-01; EU DST ends 2026-10-25.
function slot(overrides: Partial<CommitmentSlot> = {}): CommitmentSlot {
  return { typeId: TYPE, dayOfWeek: 1, startTimeLocal: "07:00", timezone: ET, ...overrides };
}

function commitment(overrides: Partial<Commitment> = {}): Commitment {
  return {
    id: "c1",
    startDate: "2026-09-28",
    weeks: 4,
    status: "active",
    cancelledAt: null,
    slots: [slot()],
    ...overrides,
  };
}

function prickle(id: string, startIso: string, typeId: string | null = TYPE, minutes = 60): SlotPrickle {
  const start = new Date(startIso);
  return {
    id,
    typeId,
    startTime: start.toISOString(),
    endTime: new Date(start.getTime() + minutes * 60000).toISOString(),
  };
}

// Mondays at 7am EDT = 11:00Z.
const MONDAY_PRICKLES = [
  prickle("p1", "2026-09-28T11:00:00Z"),
  prickle("p2", "2026-10-05T11:00:00Z"),
  prickle("p3", "2026-10-12T11:00:00Z"),
  prickle("p4", "2026-10-19T11:00:00Z"),
];

// M/W/F 5am EDT = 09:00Z, for two weeks from Mon 9/28.
const MWF = [slot({ dayOfWeek: 1, startTimeLocal: "05:00" }), slot({ dayOfWeek: 3, startTimeLocal: "05:00" }), slot({ dayOfWeek: 5, startTimeLocal: "05:00" })];
const MWF_PRICKLES = [
  prickle("m1", "2026-09-28T09:00:00Z"),
  prickle("w1", "2026-09-30T09:00:00Z"),
  prickle("f1", "2026-10-02T09:00:00Z"),
  prickle("m2", "2026-10-05T09:00:00Z"),
  prickle("w2", "2026-10-07T09:00:00Z"),
  prickle("f2", "2026-10-09T09:00:00Z"),
];

describe("window math", () => {
  it("finds the first matching weekday on or after the start date", () => {
    expect(firstOccurrenceDate("2026-09-26", 1)).toBe("2026-09-28"); // Sat -> Mon
    expect(firstOccurrenceDate("2026-09-28", 1)).toBe("2026-09-28"); // same day
    expect(firstOccurrenceDate("2026-09-29", 1)).toBe("2026-10-05"); // Tue -> next Mon
  });

  it("computes the end date the same way as the generated column", () => {
    expect(commitmentEndDate("2026-09-28", 4)).toBe("2026-10-25");
    expect(commitmentEndDate("2026-09-28", 1)).toBe("2026-10-04");
  });

  it("produces one occurrence per week per slot, each inside the window", () => {
    expect(slotOccurrenceDates("2026-09-28", 1, 4)).toEqual(["2026-09-28", "2026-10-05", "2026-10-12", "2026-10-19"]);
    // Starting Wed: Mon's first occurrence is the following Monday, still within week 1's 7 days.
    expect(slotOccurrenceDates("2026-09-30", 1, 2)).toEqual(["2026-10-05", "2026-10-12"]);
    expect(slotOccurrenceDates("2026-09-30", 3, 2)).toEqual(["2026-09-30", "2026-10-07"]);
  });

  it("covers every slot's occurrences plus tolerance in the fetch window", () => {
    const window = commitmentsFetchWindow([
      commitment({ slots: MWF, weeks: 2 }),
      commitment({ id: "c2", startDate: "2026-11-02", weeks: 1 }),
    ]);
    expect(window).toEqual({ from: "2026-09-28T08:00:00.000Z", to: "2026-11-02T13:00:00.000Z" });
    expect(commitmentsFetchWindow([])).toBeNull();
  });
});

describe("computeCommitmentProgress (single slot)", () => {
  it("counts kept and missed weeks from attendance", () => {
    const progress = computeCommitmentProgress(
      commitment(),
      MONDAY_PRICKLES,
      new Set(["p1", "p3"]),
      new Date("2026-10-21T00:00:00Z")
    );
    expect(progress.occurrences.map((o) => o.status)).toEqual(["kept", "missed", "kept", "missed"]);
    expect(progress.occurrences.map((o) => o.week)).toEqual([1, 2, 3, 4]);
    expect(progress.kept).toBe(2);
    expect(progress.missed).toBe(2);
    expect(progress.perSlot).toEqual([{ kept: 2, missed: 2, pending: 0, upcoming: 0, noSession: 0 }]);
    expect(progress.occurrences[0].prickleId).toBe("p1");
  });

  it("counts an occurrence once no matter how many attendance rows the member has for it", () => {
    const attended = buildAttendedSet([{ prickle_id: "p1" }, { prickle_id: "p1" }, { prickle_id: "p1" }, { prickle_id: "p2" }]);
    const progress = computeCommitmentProgress(commitment(), MONDAY_PRICKLES, attended, new Date("2026-10-21T00:00:00Z"));
    expect(progress.kept).toBe(2);
    expect(progress.occurrences).toHaveLength(4);
  });

  it("excludes future occurrences and holds recent unattended ones as pending", () => {
    const progress = computeCommitmentProgress(
      commitment(),
      MONDAY_PRICKLES,
      new Set(["p1"]),
      new Date("2026-10-06T00:00:00Z") // p2 ended ~12h ago
    );
    expect(progress.occurrences.map((o) => o.status)).toEqual(["kept", "pending", "upcoming", "upcoming"]);
    expect(progress.missed).toBe(0);
    expect(progress.pending).toBe(1);
    expect(progress.upcoming).toBe(2);
  });

  it("counts attendance at a session that is still in progress as kept", () => {
    const progress = computeCommitmentProgress(commitment(), MONDAY_PRICKLES, new Set(["p2"]), new Date("2026-10-05T11:30:00Z"));
    expect(progress.occurrences[1].status).toBe("kept");
  });

  it("ignores prickles outside the commitment window", () => {
    // Starts Wed 9/30 for 2 weeks: covers 10/5 and 10/12 only; attended 9/28 and 10/19 don't count.
    const progress = computeCommitmentProgress(
      commitment({ startDate: "2026-09-30", weeks: 2 }),
      MONDAY_PRICKLES,
      new Set(["p1", "p2", "p4"]),
      new Date("2026-10-25T00:00:00Z")
    );
    expect(progress.occurrences.map((o) => [o.date, o.status])).toEqual([
      ["2026-10-05", "kept"],
      ["2026-10-12", "missed"],
    ]);
  });

  it("ignores prickles of other types at the same time", () => {
    const progress = computeCommitmentProgress(
      commitment({ weeks: 1 }),
      [prickle("other", "2026-09-28T11:00:00Z", OTHER_TYPE)],
      new Set(["other"]),
      new Date("2026-10-05T00:00:00Z")
    );
    expect(progress.occurrences[0]).toMatchObject({ status: "no_session", prickleId: null });
    expect(progress.kept).toBe(0);
  });

  it("marks a past week with no matching prickle as no_session, not missed", () => {
    const withoutWeek2 = MONDAY_PRICKLES.filter((p) => p.id !== "p2");
    const progress = computeCommitmentProgress(commitment(), withoutWeek2, new Set(["p1"]), new Date("2026-10-10T00:00:00Z"));
    expect(progress.occurrences.map((o) => o.status)).toEqual(["kept", "no_session", "upcoming", "upcoming"]);
    expect(progress.missed).toBe(0);
    expect(progress.noSession).toBe(1);
  });

  it("follows the committed wall-clock time across the member's own DST change", () => {
    // 7am ET is 11:00Z on 10/26 (EDT) and 12:00Z on 11/2 (EST).
    const c = commitment({ startDate: "2026-10-26", weeks: 2 });
    expect(expectedOccurrenceStart("2026-10-26", c.slots[0]).toISOString()).toBe("2026-10-26T11:00:00.000Z");
    expect(expectedOccurrenceStart("2026-11-02", c.slots[0]).toISOString()).toBe("2026-11-02T12:00:00.000Z");

    const prickles = [prickle("a", "2026-10-26T11:00:00Z"), prickle("b", "2026-11-02T12:00:00Z")];
    const progress = computeCommitmentProgress(c, prickles, new Set(["a", "b"]), new Date("2026-11-10T00:00:00Z"));
    expect(progress.occurrences.map((o) => o.prickleId)).toEqual(["a", "b"]);
    expect(progress.kept).toBe(2);
  });

  it("still matches when the org's and member's DST changes fall on different dates", () => {
    // London member committed to "Mondays 12:00" (= 7am ET while both are on summer time). Week of
    // 10/26 London is on GMT but New York is still on EDT, so the 7am ET prickle is at 11:00 London.
    const c = commitment({
      startDate: "2026-10-12",
      weeks: 3,
      slots: [slot({ timezone: "Europe/London", startTimeLocal: "12:00" })],
    });
    const prickles = [
      prickle("w1", "2026-10-12T11:00:00Z"),
      prickle("w2", "2026-10-19T11:00:00Z"),
      prickle("w3", "2026-10-26T11:00:00Z"),
    ];
    const progress = computeCommitmentProgress(c, prickles, new Set(["w1", "w2", "w3"]), new Date("2026-11-05T00:00:00Z"));
    expect(progress.occurrences.map((o) => o.prickleId)).toEqual(["w1", "w2", "w3"]);
    expect(progress.kept).toBe(3);
  });

  it("matches the closest same-type prickle when an adjacent slot is within tolerance", () => {
    const prickles = [prickle("seven", "2026-09-28T11:00:00Z"), prickle("eight", "2026-09-28T12:00:00Z")];
    const progress = computeCommitmentProgress(
      commitment({ weeks: 1 }),
      prickles,
      new Set(["eight"]), // went to the 8am, not the committed 7am
      new Date("2026-10-01T00:00:00Z")
    );
    expect(progress.occurrences[0]).toMatchObject({ prickleId: "seven", status: "missed" });
  });

  it("drops occurrences after a cancellation and reports cancelled", () => {
    const progress = computeCommitmentProgress(
      commitment({ status: "cancelled", cancelledAt: "2026-10-08T00:00:00Z" }),
      MONDAY_PRICKLES,
      new Set(["p1"]),
      new Date("2026-10-25T00:00:00Z")
    );
    expect(progress.occurrences.map((o) => o.date)).toEqual(["2026-09-28", "2026-10-05"]);
    expect(progress.kept).toBe(1);
    expect(progress.missed).toBe(1);
    expect(progress.effectiveStatus).toBe("cancelled");
  });
});

describe("computeCommitmentProgress (multiple slots)", () => {
  const mwf = commitment({ slots: MWF, weeks: 2 });

  it("tracks every occurrence across all slots, chronologically, with per-slot and total counts", () => {
    // Now: Thu 10/8 00:00 ET. Kept M1, F1, M2; missed W1; W2 ended <24h ago (pending); F2 upcoming.
    const progress = computeCommitmentProgress(mwf, MWF_PRICKLES, new Set(["m1", "f1", "m2"]), new Date("2026-10-08T04:00:00Z"));
    expect(progress.occurrences.map((o) => [o.prickleId, o.slotIndex, o.week, o.status])).toEqual([
      ["m1", 0, 1, "kept"],
      ["w1", 1, 1, "missed"],
      ["f1", 2, 1, "kept"],
      ["m2", 0, 2, "kept"],
      ["w2", 1, 2, "pending"],
      ["f2", 2, 2, "upcoming"],
    ]);
    expect({ kept: progress.kept, missed: progress.missed, pending: progress.pending, upcoming: progress.upcoming }).toEqual({
      kept: 3,
      missed: 1,
      pending: 1,
      upcoming: 1,
    });
    expect(progress.perSlot).toEqual([
      { kept: 2, missed: 0, pending: 0, upcoming: 0, noSession: 0 },
      { kept: 0, missed: 1, pending: 1, upcoming: 0, noSession: 0 },
      { kept: 1, missed: 0, pending: 0, upcoming: 1, noSession: 0 },
    ]);
  });

  it("assigns week numbers by the commitment window, even when a slot's weekday precedes the start date's", () => {
    // Starts Wed 9/30 for 1 week: W 9/30, F 10/2, and M 10/5 are all week 1.
    const progress = computeCommitmentProgress(
      commitment({ slots: MWF, weeks: 1, startDate: "2026-09-30" }),
      MWF_PRICKLES,
      new Set(),
      new Date("2026-09-29T00:00:00Z")
    );
    expect(progress.occurrences.map((o) => [o.date, o.week])).toEqual([
      ["2026-09-30", 1],
      ["2026-10-02", 1],
      ["2026-10-05", 1],
    ]);
  });

  it("never lets two slots of one commitment claim the same prickle", () => {
    // Slots Mon 7:00 and Mon 7:30 (both same type); only a 7:00 prickle ran. It belongs to the
    // 7:00 slot (exact); the 7:30 slot has no session rather than double-counting it.
    const c = commitment({ weeks: 1, slots: [slot(), slot({ startTimeLocal: "07:30" })] });
    const progress = computeCommitmentProgress(c, [prickle("seven", "2026-09-28T11:00:00Z")], new Set(["seven"]), new Date("2026-10-01T00:00:00Z"));
    expect(progress.occurrences.map((o) => [o.slotIndex, o.prickleId, o.status])).toEqual([
      [0, "seven", "kept"],
      [1, null, "no_session"],
    ]);
    expect(progress.kept).toBe(1);
  });

  it("drops only the occurrences after a cancellation, across all slots", () => {
    const progress = computeCommitmentProgress(
      { ...mwf, status: "cancelled", cancelledAt: "2026-10-01T00:00:00Z" },
      MWF_PRICKLES,
      new Set(["m1"]),
      new Date("2026-10-20T00:00:00Z")
    );
    expect(progress.occurrences.map((o) => o.prickleId)).toEqual(["m1", "w1"]);
  });
});

describe("assignOccurrencePrickles", () => {
  it("rejects prickles beyond the tolerance", () => {
    const expected = [{ typeId: TYPE, start: new Date("2026-09-28T11:00:00Z") }];
    expect(assignOccurrencePrickles(expected, [prickle("x", "2026-09-28T12:30:00Z")])).toEqual([null]);
    expect(assignOccurrencePrickles(expected, [prickle("y", "2026-09-28T12:00:00Z")])[0]?.id).toBe("y");
  });
});

describe("effectiveCommitmentStatus", () => {
  it("reads an active commitment past its last day as completed", () => {
    const c = commitment(); // ends 2026-10-25 (local ET)
    expect(effectiveCommitmentStatus(c, new Date("2026-10-25T20:00:00Z"))).toBe("active");
    expect(effectiveCommitmentStatus(c, new Date("2026-10-26T05:00:00Z"))).toBe("completed");
    expect(effectiveCommitmentStatus({ ...c, status: "cancelled" }, new Date("2026-10-01T00:00:00Z"))).toBe("cancelled");
  });
});

describe("overlap rule", () => {
  const active = commitment({ slots: MWF, startDate: "2026-09-28", weeks: 4 }); // through 10/25

  it("detects overlapping windows (inclusive)", () => {
    expect(windowsOverlap(active, { startDate: "2026-10-25", weeks: 1 })).toBe(true);
    expect(windowsOverlap(active, { startDate: "2026-10-26", weeks: 1 })).toBe(false);
  });

  it("flags a shared slot in an overlapping window, but allows a renewal after it ends or a different slot", () => {
    const now = new Date("2026-09-27T12:00:00Z");
    const wednesday = [slot({ dayOfWeek: 3, startTimeLocal: "05:00" })];
    expect(findOverlappingCommitment({ startDate: "2026-10-05", weeks: 2, slots: wednesday }, [active], now)).toBe(active);
    expect(findOverlappingCommitment({ startDate: "2026-10-26", weeks: 4, slots: MWF }, [active], now)).toBeNull();
    expect(
      findOverlappingCommitment({ startDate: "2026-10-05", weeks: 2, slots: [slot({ dayOfWeek: 2, startTimeLocal: "05:00" })] }, [active], now)
    ).toBeNull();
    // Cancelled commitments don't block.
    expect(
      findOverlappingCommitment({ startDate: "2026-10-05", weeks: 2, slots: wednesday }, [{ ...active, status: "cancelled" }], now)
    ).toBeNull();
  });
});

describe("slots", () => {
  it("resolves an instant to a local weekday and time", () => {
    expect(slotTimeForInstant("2026-09-28T11:00:00Z", ET)).toEqual({ dayOfWeek: 1, startTimeLocal: "07:00" });
    // Midnight UTC Tuesday is still Monday evening in LA.
    expect(slotTimeForInstant("2026-09-29T00:30:00Z", "America/Los_Angeles")).toEqual({ dayOfWeek: 1, startTimeLocal: "17:30" });
  });

  it("matches a prickle to a slot exactly", () => {
    const s = slot({ startTimeLocal: "07:00:00" });
    expect(prickleMatchesSlot({ typeId: TYPE, startTime: "2026-10-05T11:00:00Z" }, s)).toBe(true);
    expect(prickleMatchesSlot({ typeId: TYPE, startTime: "2026-10-05T12:00:00Z" }, s)).toBe(false);
    expect(prickleMatchesSlot({ typeId: OTHER_TYPE, startTime: "2026-10-05T11:00:00Z" }, s)).toBe(false);
  });

  it("builds commit options from schedule rows, skipping untyped rows", () => {
    const options = buildSlotOptions(
      [
        {
          seriesKey: `${TYPE}:1-07:00`,
          typeId: TYPE,
          typeName: "Progress Prickle",
          dayOfWeek: "Monday",
          timeLabel: "7:00 AM EDT",
          hostName: "Host A",
          nextOccurrenceStart: "2026-09-28T11:00:00Z",
        },
        {
          seriesKey: "notype:2-09:00",
          typeId: null,
          typeName: "Prickle",
          dayOfWeek: "Tuesday",
          timeLabel: "9:00 AM EDT",
          hostName: null,
          nextOccurrenceStart: "2026-09-29T13:00:00Z",
        },
      ],
      ET
    );
    expect(options).toEqual([
      {
        key: `${TYPE}:1-07:00`,
        typeId: TYPE,
        dayOfWeek: 1,
        startTimeLocal: "07:00",
        timezone: ET,
        typeName: "Progress Prickle",
        label: "Monday 7:00 AM EDT · Progress Prickle with Host A",
        nextDate: "2026-09-28",
      },
    ]);
  });

  it("formats labels and collapses same-type/same-time slots into one day list", () => {
    expect(formatSlotLabel("Progress Prickle", slot())).toMatch(/^Progress Prickle · every Monday · 7 AM E[DS]T$/);
    const named = (s: CommitmentSlot, typeName = "Sprint") => ({ ...s, typeName });
    expect(formatCommitmentTitle(MWF.map((s) => named(s)))).toMatch(/^Sprint · Mon, Wed, Fri · 5 AM E[DS]T$/);
    expect(
      formatCommitmentTitle([named(slot({ dayOfWeek: 2, startTimeLocal: "19:00" }), "Deep Work"), named(MWF[0])])
    ).toMatch(/^Deep Work · Tue · 7 PM E[DS]T; Sprint · Mon · 5 AM E[DS]T$/);
  });
});

describe("validateCommitmentInput", () => {
  const NOW = new Date("2026-09-26T15:00:00Z"); // Sat 11am ET
  const valid = { slots: [slot()], startDate: "2026-09-28", weeks: 4 };

  it("accepts a valid single- and multi-slot commitment", () => {
    expect(validateCommitmentInput(valid, NOW)).toBeNull();
    expect(validateCommitmentInput({ ...valid, slots: MWF }, NOW)).toBeNull();
  });

  it.each([
    [{ slots: [] }, "Pick at least one prickle to commit to"],
    [{ slots: [slot({ typeId: "" })] }, "Pick a prickle to commit to"],
    [{ slots: [slot({ dayOfWeek: 7 })] }, "Day of week must be between 0 and 6"],
    [{ slots: [slot({ startTimeLocal: "7am" })] }, "Start time must be HH:MM"],
    [{ slots: [slot({ timezone: "Mars/Olympus" })] }, "Unknown timezone"],
    [{ slots: [slot(), slot({ startTimeLocal: "07:00:00" })] }, "The same prickle is picked twice"],
    [{ slots: [slot(), slot({ dayOfWeek: 3, timezone: "Europe/London" })] }, "All prickles in a commitment must use the same timezone"],
    [{ slots: Array.from({ length: 15 }, (_, i) => slot({ dayOfWeek: i % 7, startTimeLocal: `${String(i).padStart(2, "0")}:00` })) }, "Pick at most 14 prickles per commitment"],
    [{ startDate: "not-a-date" }, "Start date must be a valid date"],
    [{ startDate: "2026-09-25" }, "Start date can't be in the past"],
    [{ startDate: "2026-12-01" }, "Start date must be within the next 60 days"],
    [{ weeks: 0 }, "Choose between 1 and 12 weeks"],
    [{ weeks: 13 }, "Choose between 1 and 12 weeks"],
    [{ weeks: 2.5 }, "Choose between 1 and 12 weeks"],
  ])("rejects %o", (patch, message) => {
    expect(validateCommitmentInput({ ...valid, ...patch }, NOW)).toBe(message);
  });

  it("rejects a start date on which any picked session has already started", () => {
    const saturday9am = slot({ dayOfWeek: 6, startTimeLocal: "09:00" });
    const saturday7pm = slot({ dayOfWeek: 6, startTimeLocal: "19:00" });
    expect(validateCommitmentInput({ ...valid, startDate: "2026-09-26", slots: [saturday7pm, saturday9am] }, NOW)).toBe(
      "One of these prickles has already started this week -- start from a later date"
    );
    expect(validateCommitmentInput({ ...valid, startDate: "2026-09-26", slots: [saturday7pm] }, NOW)).toBeNull();
  });
});

describe("defaultCommitmentStartDate", () => {
  const NOW = new Date("2026-09-26T15:00:00Z"); // Sat 11am ET

  it("is today when every picked session is still ahead", () => {
    expect(defaultCommitmentStartDate([slot({ dayOfWeek: 6, startTimeLocal: "19:00" }), slot()], NOW)).toBe("2026-09-26");
  });

  it("moves to tomorrow when one of the picked sessions already started today", () => {
    expect(defaultCommitmentStartDate([slot({ dayOfWeek: 6, startTimeLocal: "09:00" }), slot()], NOW)).toBe("2026-09-27");
  });

  it("uses the slots' timezone for today", () => {
    // 11pm Sat in LA is already Sunday in UTC; a Sunday 9am LA slot starting "today" (Sat) is fine.
    const lateSat = new Date("2026-09-27T06:00:00Z");
    expect(defaultCommitmentStartDate([slot({ dayOfWeek: 0, startTimeLocal: "09:00", timezone: "America/Los_Angeles" })], lateSat)).toBe(
      "2026-09-26"
    );
  });
});
