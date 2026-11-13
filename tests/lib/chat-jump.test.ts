import { describe, expect, it } from "vitest";
import { addDays, BEGINNING, dayStartIso, jumpDay, jumpFrom, jumpHref, previousMonth } from "@/lib/chat/jump";

const NY = "America/New_York";

describe("calendar arithmetic", () => {
  it("adds days across month and year ends", () => {
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(addDays("2028-03-01", -1)).toBe("2028-02-29");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2027-01-03", -7)).toBe("2026-12-27");
  });

  it("goes back a month, clamping to the shorter month's last day", () => {
    expect(previousMonth("2026-11-13")).toBe("2026-10-13");
    expect(previousMonth("2026-03-31")).toBe("2026-02-28");
    expect(previousMonth("2028-03-31")).toBe("2028-02-29");
    expect(previousMonth("2026-05-31")).toBe("2026-04-30");
    expect(previousMonth("2027-01-15")).toBe("2026-12-15");
  });
});

describe("jumpDay", () => {
  it("is seen from the reader's zone, not UTC, either side of midnight", () => {
    const lateEvening = new Date("2026-11-14T03:30:00Z"); // 10:30 PM on the 13th in New York
    const afterMidnight = new Date("2026-11-14T05:30:00Z"); // 12:30 AM on the 14th
    expect(jumpDay("today", lateEvening, NY)).toBe("2026-11-13");
    expect(jumpDay("today", afterMidnight, NY)).toBe("2026-11-14");
    expect(jumpDay("yesterday", lateEvening, NY)).toBe("2026-11-12");
    expect(jumpDay("today", lateEvening, "Asia/Tokyo")).toBe("2026-11-14");
  });

  it("goes back a week and a month, and has no day for the beginning", () => {
    const now = new Date("2026-03-31T16:00:00Z");
    expect(jumpDay("last_week", now, NY)).toBe("2026-03-24");
    expect(jumpDay("last_month", now, NY)).toBe("2026-02-28");
    expect(jumpDay("beginning", now, NY)).toBeNull();
  });
});

describe("the instant a jump starts at", () => {
  it("is the start of the day in the zone, with daylight saving", () => {
    expect(dayStartIso("2026-10-07", NY)).toBe("2026-10-07T04:00:00.000Z"); // EDT
    expect(dayStartIso("2026-11-01", NY)).toBe("2026-11-01T04:00:00.000Z"); // the day clocks go back: still EDT at midnight
    expect(dayStartIso("2026-11-02", NY)).toBe("2026-11-02T05:00:00.000Z"); // EST
    expect(dayStartIso("2026-03-08", NY)).toBe("2026-03-08T05:00:00.000Z"); // the day clocks go forward: EST at midnight
    expect(dayStartIso("2026-03-09", NY)).toBe("2026-03-09T04:00:00.000Z");
    expect(dayStartIso("2026-10-07", "UTC")).toBe("2026-10-07T00:00:00.000Z");
  });

  it("is the beginning of time for the very beginning", () => {
    expect(jumpFrom("beginning", new Date("2026-11-13T12:00:00Z"), NY)).toBe(BEGINNING);
  });

  it("is the start of last week's day for last week", () => {
    expect(jumpFrom("last_week", new Date("2026-11-13T15:00:00Z"), NY)).toBe("2026-11-06T05:00:00.000Z");
  });

  it("makes the conversation's address", () => {
    expect(jumpHref("chn_AAAAAAAAAAA1", "2026-11-06T05:00:00.000Z")).toBe("/chat/chn_AAAAAAAAAAA1?from=2026-11-06T05%3A00%3A00.000Z");
  });
});
