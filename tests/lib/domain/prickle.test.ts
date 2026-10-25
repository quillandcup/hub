import { describe, it, expect } from "vitest";
import { prickleTitle } from "@/lib/domain/prickle";

// 2097-03-03 is a Sunday; the weekday is taken in the organization's zone.
const base = { title: null, startTime: "2097-03-03T15:00:00Z", host: null, type: null };

describe("prickleTitle", () => {
  it("uses the title a host gave it", () => {
    expect(prickleTitle({ ...base, title: "Tiny Things Practice Workshop", type: { name: "Sprint" } })).toBe("Tiny Things Practice Workshop");
  });

  it("names it for its weekday, type and host", () => {
    expect(prickleTitle({ ...base, type: { name: "Sprint" }, host: { name: "Jenn Parker" } })).toBe("Sunday Sprint with Jenn P");
  });

  it("leaves out the host when there is none, and falls back to Prickle without a type", () => {
    expect(prickleTitle({ ...base, type: { name: "Sprint" } })).toBe("Sunday Sprint");
    expect(prickleTitle(base)).toBe("Sunday Prickle");
  });
});
