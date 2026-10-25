import { describe, it, expect } from "vitest";
import { isAtRisk, summarizeAttendance } from "@/lib/domain/attendance";

describe("summarizeAttendance", () => {
  it("counts each member's records and keeps their latest join", () => {
    const summaries = summarizeAttendance([
      { memberId: "a", joinTime: "2026-01-02T10:00:00Z" },
      { memberId: "a", joinTime: "2026-03-04T10:00:00Z" },
      { memberId: "a", joinTime: "2026-02-01T10:00:00Z" },
      { memberId: "b", joinTime: "2026-01-01T10:00:00Z" },
    ]);

    expect(summaries.get("a")).toEqual({ count: 3, lastJoin: new Date("2026-03-04T10:00:00Z") });
    expect(summaries.get("b")?.count).toBe(1);
    expect(summaries.has("c")).toBe(false);
  });
});

describe("isAtRisk", () => {
  const since = new Date("2026-03-01T00:00:00Z");

  it("flags members with no attendance, or none since the cutoff", () => {
    expect(isAtRisk({ source: "kajabi" }, undefined, since)).toBe(true);
    expect(isAtRisk({ source: "kajabi" }, { count: 2, lastJoin: new Date("2026-02-28T23:59:59Z") }, since)).toBe(true);
  });

  it("does not flag a join exactly at the cutoff or later", () => {
    expect(isAtRisk({ source: "kajabi" }, { count: 1, lastJoin: since }, since)).toBe(false);
  });

  it("never flags staff-only accounts", () => {
    expect(isAtRisk({ source: "staff" }, undefined, since)).toBe(false);
  });
});
