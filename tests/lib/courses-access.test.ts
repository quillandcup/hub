import { describe, it, expect } from "vitest";
import { addInterval, computeCourseAccess, type CourseAccessInput } from "@/lib/courses/access";

describe("addInterval", () => {
  it("adds ISO 8601 intervals (how PostgREST serialises them)", () => {
    expect(addInterval("2026-01-15T10:00:00.000Z", "P1Y")).toBe("2027-01-15T10:00:00.000Z");
    expect(addInterval("2026-01-15T10:00:00.000Z", "P6M")).toBe("2026-07-15T10:00:00.000Z");
    expect(addInterval("2026-01-15T10:00:00.000Z", "P1Y2M10D")).toBe("2027-03-25T10:00:00.000Z");
  });

  it("adds Postgres's own interval text", () => {
    expect(addInterval("2026-01-15T10:00:00.000Z", "1 year")).toBe("2027-01-15T10:00:00.000Z");
    expect(addInterval("2026-01-15T10:00:00.000Z", "6 mons")).toBe("2026-07-15T10:00:00.000Z");
    expect(addInterval("2026-01-15T10:00:00.000Z", "1 year 30 days")).toBe("2027-02-14T10:00:00.000Z");
  });

  it("refuses what it can't add exactly", () => {
    expect(() => addInterval("2026-01-15T10:00:00.000Z", "PT36H")).toThrow(/Unsupported/);
    expect(() => addInterval("2026-01-15T10:00:00.000Z", "P")).toThrow(/Unsupported/);
    expect(() => addInterval("2026-01-15T10:00:00.000Z", "2 weeks")).toThrow(/Unsupported/);
    expect(() => addInterval("2026-01-15T10:00:00.000Z", "soon")).toThrow(/Unsupported/);
  });
});

const purchase = (over: Partial<CourseAccessInput["purchases"][number]> = {}) => ({
  kajabi_customer_id: "cust-1",
  kajabi_offer_id: "offer-1",
  created_at_kajabi: "2026-03-01T00:00:00.000Z",
  effective_start_at: null,
  deactivated_at: null,
  ...over,
});

const base = (over: Partial<CourseAccessInput> = {}): CourseAccessInput => ({
  courses: [{ id: "course-1", offerIds: new Set(["offer-1"]), accessDuration: "P1Y" }],
  purchases: [purchase()],
  emailByCustomerId: new Map([["cust-1", "a@example.test"]]),
  memberIdByEmail: new Map([["a@example.test", "member-1"]]),
  grants: [],
  ...over,
});

describe("computeCourseAccess", () => {
  it("grants access from an active purchase of the course's offer, for the course's duration", () => {
    expect(computeCourseAccess(base())).toEqual([
      { member_id: "member-1", course_id: "course-1", starts_at: "2026-03-01T00:00:00.000Z", ends_at: "2027-03-01T00:00:00.000Z", origin: "purchase" },
    ]);
  });

  it("is lifetime when the course has no access duration", () => {
    const [row] = computeCourseAccess(base({ courses: [{ id: "course-1", offerIds: new Set(["offer-1"]), accessDuration: null }] }));
    expect(row.ends_at).toBeNull();
  });

  it("gives nothing for a refunded or cancelled purchase", () => {
    expect(computeCourseAccess(base({ purchases: [purchase({ deactivated_at: "2026-04-01T00:00:00.000Z" })] }))).toEqual([]);
  });

  it("ignores purchases of other offers and of people who aren't members", () => {
    expect(computeCourseAccess(base({ purchases: [purchase({ kajabi_offer_id: "other" })] }))).toEqual([]);
    expect(computeCourseAccess(base({ memberIdByEmail: new Map() }))).toEqual([]);
  });

  it("starts at created_at_kajabi, falling back to effective_start_at", () => {
    const [row] = computeCourseAccess(
      base({ purchases: [purchase({ created_at_kajabi: null, effective_start_at: "2026-02-01T00:00:00.000Z" })] })
    );
    expect(row.starts_at).toBe("2026-02-01T00:00:00.000Z");
  });

  it("keeps the access that lasts longest when someone buys again", () => {
    const rows = computeCourseAccess(
      base({
        purchases: [purchase({ created_at_kajabi: "2024-01-01T00:00:00.000Z" }), purchase({ created_at_kajabi: "2026-03-01T00:00:00.000Z" })],
      })
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].starts_at).toBe("2026-03-01T00:00:00.000Z");
  });

  it("lets a grant extend, or open-end, what a purchase gave", () => {
    const rows = computeCourseAccess(
      base({ grants: [{ member_id: "member-1", course_id: "course-1", starts_at: "2026-03-01T00:00:00.000Z", ends_at: null }] })
    );
    expect(rows).toEqual([
      { member_id: "member-1", course_id: "course-1", starts_at: "2026-03-01T00:00:00.000Z", ends_at: null, origin: "grant" },
    ]);
  });

  it("gives a grant access with no purchase at all, and ignores grants for other courses", () => {
    const rows = computeCourseAccess(
      base({
        purchases: [],
        grants: [
          { member_id: "member-2", course_id: "course-1", starts_at: "2026-05-01T00:00:00.000Z", ends_at: "2026-06-01T00:00:00.000Z" },
          { member_id: "member-3", course_id: "elsewhere", starts_at: "2026-05-01T00:00:00.000Z", ends_at: null },
        ],
      })
    );
    expect(rows.map((r) => r.member_id)).toEqual(["member-2"]);
  });
});
