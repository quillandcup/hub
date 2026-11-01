import { describe, expect, it } from "vitest";
import { eventSlugCandidates } from "@/lib/calendar-events";

describe("eventSlugCandidates", () => {
  it("goes from the readable address to one only this prickle can have", () => {
    // 14:00 UTC on 2027-02-01 is 09:00 Eastern.
    expect(eventSlugCandidates("Heads Down", "2027-02-01T14:00:00Z", "prkl_AAAAAAAAAWXY")).toEqual([
      "heads-down-2027-02-01",
      "heads-down-2027-02-01-0900",
      "heads-down-2027-02-01-0900-awxy",
    ]);
  });

  it("names the day and the time in Eastern, either side of midnight", () => {
    // 04:30 UTC is 23:30 the evening before in winter; 05:30 UTC is 00:30 the same day.
    expect(eventSlugCandidates("Late", "2027-02-02T04:30:00Z", "prkl_BBBBBBBBBBBB").slice(0, 2)).toEqual(["late-2027-02-01", "late-2027-02-01-2330"]);
    expect(eventSlugCandidates("Late", "2027-02-02T05:30:00Z", "prkl_BBBBBBBBBBBB").slice(0, 2)).toEqual(["late-2027-02-02", "late-2027-02-02-0030"]);
  });

  it("gives the same prickle the same addresses every time and different prickles different last ones", () => {
    const a = eventSlugCandidates("Open Table", "2027-03-14T14:00:00Z", "prkl_CCCCCCCCCCC1");
    expect(eventSlugCandidates("Open Table", "2027-03-14T14:00:00Z", "prkl_CCCCCCCCCCC1")).toEqual(a);
    expect(eventSlugCandidates("Open Table", "2027-03-14T14:00:00Z", "prkl_CCCCCCCCCCC2")[2]).not.toBe(a[2]);
  });

  it("falls back to a word when the title has nothing to slug", () => {
    expect(eventSlugCandidates("!!!", "2027-02-01T14:00:00Z", "prkl_DDDDDDDDDDDD")[0]).toBe("event-2027-02-01");
  });
});
