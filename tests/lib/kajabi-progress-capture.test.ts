import { describe, it, expect } from "vitest";
import { memberReportUrl, parseKajabiDay, parseKajabiInstant, parseMemberProgress, parseRoster } from "@/lib/kajabi/progress-capture";

const NY = "America/New_York";

describe("parseKajabiInstant", () => {
  it("reads a bare date as noon in the organisation's timezone, winter and summer", () => {
    expect(parseKajabiInstant("2026-01-05", NY)).toBe("2026-01-05T17:00:00.000Z");
    expect(parseKajabiInstant("2026-07-05", NY)).toBe("2026-07-05T16:00:00.000Z");
  });

  it("keeps the same local day across the daylight saving changes", () => {
    expect(parseKajabiInstant("2026-03-08", NY)).toBe("2026-03-08T16:00:00.000Z");
    expect(parseKajabiInstant("2026-11-01", NY)).toBe("2026-11-01T17:00:00.000Z");
  });

  it("takes a timestamp as given, and treats one without a zone as UTC", () => {
    expect(parseKajabiInstant("2026-01-05T09:30:00-05:00", NY)).toBe("2026-01-05T14:30:00.000Z");
    expect(parseKajabiInstant("2026-01-05T14:30:00Z", NY)).toBe("2026-01-05T14:30:00.000Z");
    expect(parseKajabiInstant("2026-01-05 14:30:00", NY)).toBe("2026-01-05T14:30:00.000Z");
  });

  it.each([[null], [undefined], [""], ["not a date"], ["2026-02-31"], [20260105]])("gives null for %j", (value) => {
    expect(parseKajabiInstant(value, NY)).toBeNull();
  });
});

describe("parseKajabiDay", () => {
  it("returns a bare date as is and a timestamp as its day in the zone", () => {
    expect(parseKajabiDay("2026-01-05", NY)).toBe("2026-01-05");
    expect(parseKajabiDay("2026-01-06T02:30:00Z", NY)).toBe("2026-01-05");
    expect(parseKajabiDay("2026-01-06T06:30:00Z", NY)).toBe("2026-01-06");
    expect(parseKajabiDay(null, NY)).toBeNull();
    expect(parseKajabiDay("2026-13-40", NY)).toBeNull();
  });
});

describe("parseRoster", () => {
  const member = (over: Record<string, unknown> = {}) => ({
    contact_id: 11,
    member_id: 111,
    email: " Ada@Example.com ",
    name: "Ada Example",
    percent_complete: 62.456,
    sign_in_count: 4,
    start_date: "2026-01-05",
    last_request_at: "2026-02-01T15:00:00Z",
    deleted_at: null,
    certificate_serial_number: null,
    ...over,
  });

  it("maps a student to a progress row, lowercasing the email and rounding the percent", () => {
    const parsed = parseRoster({ count: 1, members: [member()] }, NY);
    expect(parsed).toEqual({
      count: 1,
      skipped: 0,
      entries: [
        { contactId: "11", memberId: "111", email: "ada@example.com", percent: 62.46, logins: 4, startedOn: "2026-01-05", lastActivityOn: "2026-02-01" },
      ],
    });
  });

  it("is tolerant: missing fields become null, unusable entries are counted and skipped", () => {
    const parsed = parseRoster(
      {
        members: [
          member({ start_date: null, last_request_at: undefined, sign_in_count: null, percent_complete: null, contact_id: null }),
          member({ member_id: null }),
          member({ email: "nope" }),
          "junk",
        ],
      },
      NY,
    );
    expect(parsed.count).toBeNull();
    expect(parsed.skipped).toBe(3);
    expect(parsed.entries).toEqual([
      { contactId: null, memberId: "111", email: "ada@example.com", percent: 0, logins: null, startedOn: null, lastActivityOn: null },
    ]);
  });

  it("clamps the percent to 0..100 and survives a response of the wrong shape", () => {
    expect(parseRoster({ members: [member({ percent_complete: 140 }), member({ member_id: 2, email: "b@example.com", percent_complete: -3 })] }, NY).entries.map((e) => e.percent)).toEqual([100, 0]);
    expect(parseRoster(null, NY)).toEqual({ count: null, entries: [], skipped: 0 });
    expect(parseRoster({ members: "x" }, NY).entries).toEqual([]);
  });
});

describe("parseMemberProgress", () => {
  const report = {
    member: { id: 111, contact_id: 11, email: "ada@example.com", name: "Ada Example" },
    product: {
      id: 9,
      categories: [
        {
          id: 1,
          title: "Module",
          parent_category: null,
          posts: [
            { id: 501, title: "One", completed: true, completed_date: "2026-01-05", progress_percent: 100 },
            { id: 502, title: "Two", completed: false, completed_date: null, progress_percent: 40 },
          ],
        },
        {
          id: 2,
          title: "Week 1",
          parent_category: 1,
          posts: [{ id: 503, title: "Three", completed: true, completed_date: "2026-01-06T10:00:00Z", progress_percent: 100 }, { title: "no id" }],
        },
        { id: 3, title: "Empty" },
      ],
    },
  };

  it("lists every lesson of every module and week with Kajabi's completion", () => {
    const parsed = parseMemberProgress(report, NY);
    expect(parsed.memberId).toBe("111");
    expect(parsed.contactId).toBe("11");
    expect(parsed.lessons).toEqual([
      { kajabiLessonId: "501", completed: true, completedAt: "2026-01-05T17:00:00.000Z", percent: 100 },
      { kajabiLessonId: "502", completed: false, completedAt: null, percent: 40 },
      { kajabiLessonId: "503", completed: true, completedAt: "2026-01-06T10:00:00.000Z", percent: 100 },
    ]);
  });

  it("keeps the completed copy of a lesson listed twice, and ignores a date on an incomplete lesson", () => {
    const parsed = parseMemberProgress(
      {
        member: { id: 1 },
        product: {
          categories: [
            { posts: [{ id: 7, completed: false, completed_date: "2026-01-01", progress_percent: 10 }] },
            { posts: [{ id: 7, completed: true, completed_date: null, progress_percent: 100 }] },
          ],
        },
      },
      NY,
    );
    expect(parsed.lessons).toEqual([{ kajabiLessonId: "7", completed: true, completedAt: null, percent: 100 }]);
  });

  it("gives nothing for a response of the wrong shape", () => {
    expect(parseMemberProgress({}, NY)).toEqual({ memberId: null, contactId: null, lessons: [] });
    expect(parseMemberProgress(undefined, NY).lessons).toEqual([]);
  });
});

describe("memberReportUrl", () => {
  it("keeps the origin and query string and appends the student to the path", () => {
    expect(memberReportUrl("https://app.example.test/api/client/reports/product_progress/9?productId=9&site_id=3", "111")).toBe(
      "https://app.example.test/api/client/reports/product_progress/9/members/111?productId=9&site_id=3",
    );
  });
});
