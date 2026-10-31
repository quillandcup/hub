import { describe, expect, it } from "vitest";
import { eventWindow } from "@/lib/event-window";
import { windowInputs } from "@/lib/event-window-inputs";

describe("eventWindow", () => {
  it("makes dates alone an all-day window: Eastern midnight to Eastern midnight after the last day", () => {
    expect(eventWindow({ startDate: "2097-04-01", endDate: "2097-04-03" })).toEqual({ ok: true, startTime: "2097-04-01T04:00:00.000Z", endTime: "2097-04-04T04:00:00.000Z" });
  });

  it("reads clock times in Eastern time, summer and winter", () => {
    expect(eventWindow({ startDate: "2097-07-01", endDate: "2097-07-01", startClock: "10:00", endClock: "11:30" })).toEqual({ ok: true, startTime: "2097-07-01T14:00:00.000Z", endTime: "2097-07-01T15:30:00.000Z" });
    expect(eventWindow({ startDate: "2097-01-05", endDate: "2097-01-05", startClock: "10:00", endClock: "11:30" })).toEqual({ ok: true, startTime: "2097-01-05T15:00:00.000Z", endTime: "2097-01-05T16:30:00.000Z" });
  });

  it("keeps a day 23 or 25 hours long when the clocks change", () => {
    const spring = eventWindow({ startDate: "2097-03-10", endDate: "2097-03-10" });
    const autumn = eventWindow({ startDate: "2097-11-03", endDate: "2097-11-03" });
    const hours = (w: typeof spring) => (w.ok ? (Date.parse(w.endTime) - Date.parse(w.startTime)) / 3_600_000 : NaN);
    expect([hours(spring), hours(autumn)].sort()).toEqual([23, 25]);
  });

  it.each([
    [{ startDate: "", endDate: "2097-04-03" }, "dates are required"],
    [{ startDate: "2097-04-03", endDate: "2097-04-01" }, "before it starts"],
    [{ startDate: "2097-04-01", endDate: "2097-04-01", startClock: "10:00" }, "both a start and an end time"],
    [{ startDate: "2097-04-01", endDate: "2097-04-01", startClock: "25:00", endClock: "26:00" }, "HH:MM"],
    [{ startDate: "2097-04-01", endDate: "2097-04-01", startClock: "11:00", endClock: "10:00" }, "end after it starts"],
  ])("refuses %j", (input, message) => {
    const result = eventWindow(input);
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toContain(message);
  });
});

describe("windowInputs", () => {
  it("gives dates alone back for an all-day window, and clock times for a timed one", () => {
    expect(windowInputs("2097-04-01T04:00:00.000Z", "2097-04-04T04:00:00.000Z")).toEqual({ startDate: "2097-04-01", endDate: "2097-04-03", startClock: "", endClock: "" });
    expect(windowInputs("2097-07-01T14:00:00.000Z", "2097-07-01T15:30:00.000Z")).toEqual({ startDate: "2097-07-01", endDate: "2097-07-01", startClock: "10:00", endClock: "11:30" });
  });

  it("round-trips what eventWindow made", () => {
    for (const input of [
      { startDate: "2097-03-10", endDate: "2097-03-12", startClock: "", endClock: "" },
      { startDate: "2097-11-03", endDate: "2097-11-04", startClock: "09:15", endClock: "17:45" },
    ]) {
      const w = eventWindow(input);
      expect(w.ok && windowInputs(w.startTime, w.endTime)).toEqual(input);
    }
  });
});
