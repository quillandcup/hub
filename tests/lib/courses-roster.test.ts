import { describe, expect, it, vi } from "vitest";
import { buildRoster } from "@/lib/courses/roster";
import { loadCourseRoster } from "@/lib/courses/roster-data";

vi.mock("@/lib/data/repos", () => ({
  createRepos: () => ({
    members: {
      byIds: async (ids: string[]) => ids.map((id) => ({ id, name: `Name ${id}`, displayName: id === "m2" ? "Shown Two" : null })),
    },
  }),
}));

const NOW = new Date("2026-10-27T12:00:00Z");
const lessons = [
  { id: "l1", title: "One", state: "open" },
  { id: "l2", title: "Two", state: "open" },
  { id: "l3", title: "Soon", state: "coming_soon" },
];

describe("buildRoster", () => {
  it("counts completed open lessons, finds the last lesson and flags ended access", () => {
    const rows = buildRoster(
      [
        { memberId: "m1", startsAt: "2026-09-01T00:00:00Z", endsAt: null, origin: "purchase" },
        { memberId: "m2", startsAt: "2026-01-01T00:00:00Z", endsAt: "2026-02-01T00:00:00Z", origin: "grant" },
        { memberId: "m3", startsAt: "2026-10-01T00:00:00Z", endsAt: null, origin: "purchase" },
      ],
      new Map([["m1", "Ada Example"]]),
      lessons,
      [
        { memberId: "m1", lessonId: "l1", completedAt: "2026-10-02T00:00:00Z", updatedAt: "2026-10-02T00:00:00Z" },
        { memberId: "m1", lessonId: "l3", completedAt: "2026-10-03T00:00:00Z", updatedAt: "2026-10-05T00:00:00Z" },
        { memberId: "m1", lessonId: "l2", completedAt: null, updatedAt: "2026-10-04T00:00:00Z" },
      ],
      NOW
    );
    expect(rows[0]).toMatchObject({ name: "Ada Example", completed: 1, total: 2, lastLessonTitle: "Soon", lastActivityAt: "2026-10-05T00:00:00Z", accessActive: true });
    expect(rows[1]).toMatchObject({ name: "Unknown member", accessActive: false, lastLessonId: null, lastActivityAt: null, completed: 0 });
    expect(rows[2].lastLessonTitle).toBeNull();
  });
});

/** A chainable fake that serves `tables` honoring in(), eq() and range(). */
function fakeSupabase(tables: Record<string, Record<string, unknown>[]>) {
  const ranges: Record<string, number> = {};
  return {
    ranges,
    from(table: string) {
      let rows = tables[table] ?? [];
      const q: any = {
        select: () => q,
        eq: (c: string, v: unknown) => ((rows = rows.filter((r) => r[c] === v)), q),
        in: (c: string, vs: unknown[]) => ((rows = rows.filter((r) => vs.includes(r[c]))), q),
        order: () => q,
        range: (a: number, b: number) => {
          ranges[table] = (ranges[table] ?? 0) + 1;
          return Promise.resolve({ data: rows.slice(a, b + 1), error: null });
        },
        maybeSingle: () => Promise.resolve({ data: rows[0] ?? null, error: null }),
      };
      return q;
    },
  } as any;
}

describe("loadCourseRoster", () => {
  it("returns null for an unknown course", async () => {
    expect(await loadCourseRoster(fakeSupabase({ courses: [] }), "nope", NOW)).toBeNull();
  });

  it("pages past 1000 access and progress rows without a query per member", async () => {
    const members = Array.from({ length: 1500 }, (_, i) => `mbr_${i}`);
    const db = fakeSupabase({
      courses: [{ id: "c1", title: "Course", source: "kajabi", source_key: "k1" }],
      course_access: members.map((m) => ({ course_id: "c1", member_id: m, starts_at: "2026-01-01T00:00:00Z", ends_at: null, origin: "purchase" })),
      course_lessons: [{ course_id: "c1", id: "l1", title: "One", state: "open" }],
      lesson_progress: members.map((m) => ({ lesson_id: "l1", member_id: m, completed_at: "2026-10-01T00:00:00Z", updated_at: "2026-10-01T00:00:00Z" })),
    });
    const data = await loadCourseRoster(db, "k1", NOW);
    expect(data!.rows).toHaveLength(1500);
    expect(data!.rows.every((r) => r.completed === 1 && r.total === 1)).toBe(true);
    expect(db.ranges.course_access).toBe(2);
    expect(db.ranges.lesson_progress).toBe(2);
  });
});
