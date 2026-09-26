import { describe, it, expect } from "vitest";
import {
  buildAttendedSet,
  buildSlotOptions,
  commitmentEndDate,
  commitmentOccurrenceDates,
  commitmentsFetchWindow,
  computeCommitmentProgress,
  effectiveCommitmentStatus,
  expectedOccurrenceStart,
  firstOccurrenceDate,
  formatCommitmentLabel,
  matchOccurrencePrickle,
  prickleMatchesSlot,
  slotTimeForInstant,
  validateCommitmentInput,
  type Commitment,
  type SlotPrickle,
} from "@/lib/commitments";

const TYPE = "type-progress";
const OTHER_TYPE = "type-other";

// 2026-09-28 is a Monday. US DST ends 2026-11-01; EU DST ends 2026-10-25.
function commitment(overrides: Partial<Commitment> = {}): Commitment {
  return {
    id: "c1",
    typeId: TYPE,
    dayOfWeek: 1,
    startTimeLocal: "07:00",
    timezone: "America/New_York",
    startDate: "2026-09-28",
    weeks: 4,
    status: "active",
    cancelledAt: null,
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

  it("produces one occurrence per week", () => {
    expect(commitmentOccurrenceDates(commitment())).toEqual(["2026-09-28", "2026-10-05", "2026-10-12", "2026-10-19"]);
    expect(commitmentOccurrenceDates(commitment({ startDate: "2026-09-30", weeks: 2 }))).toEqual([
      "2026-10-05",
      "2026-10-12",
    ]);
  });

  it("covers every occurrence plus tolerance in the fetch window", () => {
    const window = commitmentsFetchWindow([commitment(), commitment({ id: "c2", startDate: "2026-11-02", weeks: 1 })]);
    expect(window).toEqual({ from: "2026-09-28T10:00:00.000Z", to: "2026-11-02T13:00:00.000Z" });
    expect(commitmentsFetchWindow([])).toBeNull();
  });
});

describe("computeCommitmentProgress", () => {
  it("counts kept and missed weeks from attendance", () => {
    const progress = computeCommitmentProgress(
      commitment(),
      MONDAY_PRICKLES,
      new Set(["p1", "p3"]),
      new Date("2026-10-21T00:00:00Z")
    );
    expect(progress.occurrences.map((o) => o.status)).toEqual(["kept", "missed", "kept", "missed"]);
    expect(progress.kept).toBe(2);
    expect(progress.missed).toBe(2);
    expect(progress.occurrences[0].prickleId).toBe("p1");
  });

  it("counts a week once no matter how many attendance rows the member has for it", () => {
    const attended = buildAttendedSet([
      { prickle_id: "p1" },
      { prickle_id: "p1" },
      { prickle_id: "p1" },
      { prickle_id: "p2" },
    ]);
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
    const progress = computeCommitmentProgress(
      commitment(),
      MONDAY_PRICKLES,
      new Set(["p2"]),
      new Date("2026-10-05T11:30:00Z")
    );
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
    const progress = computeCommitmentProgress(
      commitment(),
      withoutWeek2,
      new Set(["p1"]),
      new Date("2026-10-10T00:00:00Z")
    );
    expect(progress.occurrences.map((o) => o.status)).toEqual(["kept", "no_session", "upcoming", "upcoming"]);
    expect(progress.missed).toBe(0);
    expect(progress.noSession).toBe(1);
  });

  it("follows the committed wall-clock time across the member's own DST change", () => {
    // 7am ET is 11:00Z on 10/26 (EDT) and 12:00Z on 11/2 (EST).
    const c = commitment({ startDate: "2026-10-26", weeks: 2 });
    expect(expectedOccurrenceStart("2026-10-26", c).toISOString()).toBe("2026-10-26T11:00:00.000Z");
    expect(expectedOccurrenceStart("2026-11-02", c).toISOString()).toBe("2026-11-02T12:00:00.000Z");

    const prickles = [prickle("a", "2026-10-26T11:00:00Z"), prickle("b", "2026-11-02T12:00:00Z")];
    const progress = computeCommitmentProgress(c, prickles, new Set(["a", "b"]), new Date("2026-11-10T00:00:00Z"));
    expect(progress.occurrences.map((o) => o.prickleId)).toEqual(["a", "b"]);
    expect(progress.kept).toBe(2);
  });

  it("still matches when the org's and member's DST changes fall on different dates", () => {
    // London member committed to "Mondays 12:00" (= 7am ET while both are on summer time).
    // Week of 10/26 London is on GMT but New York is still on EDT, so the 7am ET prickle is at
    // 11:00 London -- an hour off, within tolerance.
    const c = commitment({ timezone: "Europe/London", startTimeLocal: "12:00", startDate: "2026-10-12", weeks: 3 });
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

describe("matchOccurrencePrickle", () => {
  it("rejects prickles beyond the tolerance", () => {
    const expected = new Date("2026-09-28T11:00:00Z");
    expect(matchOccurrencePrickle(expected, TYPE, [prickle("x", "2026-09-28T12:30:00Z")])).toBeNull();
    expect(matchOccurrencePrickle(expected, TYPE, [prickle("y", "2026-09-28T12:00:00Z")])?.id).toBe("y");
  });
});

describe("effectiveCommitmentStatus", () => {
  it("reads an active commitment past its last day as completed", () => {
    const c = commitment(); // ends 2026-10-25 (local ET)
    expect(effectiveCommitmentStatus(c, new Date("2026-10-25T20:00:00Z"))).toBe("active");
    expect(effectiveCommitmentStatus(c, new Date("2026-10-26T05:00:00Z"))).toBe("completed");
    expect(effectiveCommitmentStatus({ ...c, status: "cancelled" }, new Date("2026-10-01T00:00:00Z"))).toBe(
      "cancelled"
    );
  });
});

describe("slots", () => {
  it("resolves an instant to a local weekday and time", () => {
    expect(slotTimeForInstant("2026-09-28T11:00:00Z", "America/New_York")).toEqual({
      dayOfWeek: 1,
      startTimeLocal: "07:00",
    });
    // Midnight UTC Tuesday is still Monday evening in LA.
    expect(slotTimeForInstant("2026-09-29T00:30:00Z", "America/Los_Angeles")).toEqual({
      dayOfWeek: 1,
      startTimeLocal: "17:30",
    });
  });

  it("matches a prickle to a slot exactly", () => {
    const slot = { typeId: TYPE, dayOfWeek: 1, startTimeLocal: "07:00:00", timezone: "America/New_York" };
    expect(prickleMatchesSlot({ typeId: TYPE, startTime: "2026-10-05T11:00:00Z" }, slot)).toBe(true);
    expect(prickleMatchesSlot({ typeId: TYPE, startTime: "2026-10-05T12:00:00Z" }, slot)).toBe(false);
    expect(prickleMatchesSlot({ typeId: OTHER_TYPE, startTime: "2026-10-05T11:00:00Z" }, slot)).toBe(false);
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
      "America/New_York"
    );
    expect(options).toEqual([
      {
        key: `${TYPE}:1-07:00`,
        typeId: TYPE,
        dayOfWeek: 1,
        startTimeLocal: "07:00",
        timezone: "America/New_York",
        typeName: "Progress Prickle",
        label: "Monday 7:00 AM EDT · Progress Prickle with Host A",
        nextDate: "2026-09-28",
      },
    ]);
  });

  it("formats a readable label", () => {
    expect(formatCommitmentLabel("Progress Prickle", commitment())).toMatch(/^Progress Prickle · every Monday · 7 AM E[DS]T$/);
  });
});

describe("validateCommitmentInput", () => {
  const NOW = new Date("2026-09-26T15:00:00Z"); // Sat 11am ET
  const valid = {
    typeId: TYPE,
    dayOfWeek: 1,
    startTimeLocal: "07:00",
    timezone: "America/New_York",
    startDate: "2026-09-28",
    weeks: 4,
  };

  it("accepts a valid commitment", () => {
    expect(validateCommitmentInput(valid, NOW)).toBeNull();
  });

  it.each([
    [{ typeId: "" }, "Pick a prickle to commit to"],
    [{ dayOfWeek: 7 }, "Day of week must be between 0 and 6"],
    [{ startTimeLocal: "7am" }, "Start time must be HH:MM"],
    [{ timezone: "Mars/Olympus" }, "Unknown timezone"],
    [{ startDate: "not-a-date" }, "Start date must be a valid date"],
    [{ startDate: "2026-09-25" }, "Start date can't be in the past"],
    [{ startDate: "2026-12-01" }, "Start date must be within the next 60 days"],
    [{ weeks: 0 }, "Choose between 1 and 12 weeks"],
    [{ weeks: 13 }, "Choose between 1 and 12 weeks"],
    [{ weeks: 2.5 }, "Choose between 1 and 12 weeks"],
  ])("rejects %o", (patch, message) => {
    expect(validateCommitmentInput({ ...valid, ...patch }, NOW)).toBe(message);
  });

  it("rejects starting today when today's session has already started", () => {
    const saturdaySlot = { ...valid, dayOfWeek: 6, startTimeLocal: "09:00", startDate: "2026-09-26" };
    expect(validateCommitmentInput(saturdaySlot, NOW)).toBe(
      "This week's session has already started -- start from next week instead"
    );
    expect(validateCommitmentInput({ ...saturdaySlot, startTimeLocal: "19:00" }, NOW)).toBeNull();
  });
});
