import { describe, it, expect } from "vitest";
import { orgWeek, orgYmd, sundayOnOrBefore } from "@/lib/org-week";

describe("orgYmd", () => {
  it("uses the Eastern date on both sides of Eastern midnight", () => {
    expect(orgYmd(new Date("2026-07-20T03:59:00Z"))).toBe("2026-07-19");
    expect(orgYmd(new Date("2026-07-20T04:01:00Z"))).toBe("2026-07-20");
  });
});

describe("sundayOnOrBefore", () => {
  it("snaps to Sunday and keeps a Sunday", () => {
    expect(sundayOnOrBefore("2026-07-22")).toBe("2026-07-19");
    expect(sundayOnOrBefore("2026-07-19")).toBe("2026-07-19");
    expect(sundayOnOrBefore("2026-07-18")).toBe("2026-07-12");
  });
});

describe("orgWeek", () => {
  it("defaults to the Eastern week: Saturday 23:30 and Sunday 00:30 Eastern fall in different weeks", () => {
    const sat = orgWeek(undefined, new Date("2026-07-19T03:30:00Z")); // Sat Jul 18, 23:30 EDT
    const sun = orgWeek(undefined, new Date("2026-07-19T04:30:00Z")); // Sun Jul 19, 00:30 EDT
    expect(sat.start).toBe("2026-07-12");
    expect(sun.start).toBe("2026-07-19");
    expect(sun.startInstant.toISOString()).toBe("2026-07-19T04:00:00.000Z");
    expect(sun.endInstant.toISOString()).toBe("2026-07-26T04:00:00.000Z");
  });

  it("normalizes a ?week= param to its Sunday and ignores a malformed one", () => {
    const now = new Date("2026-07-22T16:00:00Z");
    expect(orgWeek("2026-07-15", now).start).toBe("2026-07-12");
    expect(orgWeek("garbage", now).start).toBe("2026-07-19");
    expect(orgWeek("2026-07-15", now).prev).toBe("2026-07-05");
    expect(orgWeek("2026-07-15", now).next).toBe("2026-07-19");
  });

  it("flags the next week as future only past the current one", () => {
    const now = new Date("2026-07-22T16:00:00Z");
    expect(orgWeek(undefined, now).next > orgWeek(undefined, now).today).toBe(true);
    expect(orgWeek("2026-07-05", now).next > orgWeek("2026-07-05", now).today).toBe(false);
  });

  it("spring-forward week is 167 hours", () => {
    const w = orgWeek("2026-03-08", new Date("2026-03-10T12:00:00Z"));
    expect(w.startInstant.toISOString()).toBe("2026-03-08T05:00:00.000Z");
    expect(w.endInstant.toISOString()).toBe("2026-03-15T04:00:00.000Z");
  });

  it("fall-back week is 169 hours", () => {
    const w = orgWeek("2026-11-01", new Date("2026-11-03T12:00:00Z"));
    expect(w.startInstant.toISOString()).toBe("2026-11-01T04:00:00.000Z");
    expect(w.endInstant.toISOString()).toBe("2026-11-08T05:00:00.000Z");
  });
});
