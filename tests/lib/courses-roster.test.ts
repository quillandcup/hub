import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { buildRoster } from "@/lib/courses/roster";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { createInMemoryRepos } from "@/lib/data/repos";
import { accessRow, courseRow, lessonRow, progressRow } from "@/tests/helpers/course-fixtures";
import { loadCourseRoster } from "@/lib/courses/roster-data";
import { createRepos } from "@/lib/data/repos";

let dataset = new InMemoryDataset();
vi.mock("@/lib/data/repos", async () => ({
  ...(await vi.importActual<typeof import("@/lib/data/repos")>("@/lib/data/repos")),
  createRepos: () => createInMemoryRepos(dataset),
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

  it("carries the legal name beside the display name", () => {
    const [row] = buildRoster([{ memberId: "m1", startsAt: "2026-01-01T00:00:00Z", endsAt: null, origin: "grant" }], new Map([["m1", "Ada E"]]), lessons, [], NOW, new Map([["m1", "Ada Example"]]));
    expect(row).toMatchObject({ name: "Ada E", realName: "Ada Example" });
  });
});

describe("loadCourseRoster", () => {
  const client = {} as SupabaseClient;

  it("returns null for an unknown course", async () => {
    dataset = new InMemoryDataset();
    expect(await loadCourseRoster(createRepos(client), "crs_AAAAAAAAAAA9", NOW)).toBeNull();
  });

  it("still lists a draft course, so staff can see who has access before it opens", async () => {
    dataset = new InMemoryDataset({ courses: [courseRow({ id: "crs_AAAAAAAAAAA1", slug: "draft", title: "Course", source: "kajabi", source_key: "k1", is_draft: true })] });
    expect((await loadCourseRoster(createRepos(client), "crs_AAAAAAAAAAA1", NOW))!.rows).toEqual([]);
  });

  it("finds the course by its slug as well as its id", async () => {
    dataset = new InMemoryDataset({ courses: [courseRow({ id: "crs_AAAAAAAAAAA1", slug: "the-ready-writer", title: "Course" })] });
    expect((await loadCourseRoster(createRepos(client), "the-ready-writer", NOW))!.course).toEqual({ id: "crs_AAAAAAAAAAA1", title: "Course" });
  });

  it("lists everyone with access, with the name they are known by and their progress", async () => {
    dataset = new InMemoryDataset({
      members: [
        { id: "mbr_AAAAAAAAAAA1", name: "Ada Example", displayName: "Ada E" },
        { id: "mbr_AAAAAAAAAAA2", name: "Bo Example" },
      ],
      courses: [courseRow({ id: "crs_AAAAAAAAAAA1", slug: "course", title: "Course" })],
      courseLessons: [lessonRow({ id: "les_AAAAAAAAAAA1", course_id: "crs_AAAAAAAAAAA1", title: "One" })],
      courseAccess: [
        accessRow({ member_id: "mbr_AAAAAAAAAAA1", course_id: "crs_AAAAAAAAAAA1", starts_at: "2026-01-01T00:00:00Z" }),
        accessRow({ member_id: "mbr_AAAAAAAAAAA2", course_id: "crs_AAAAAAAAAAA1", starts_at: "2026-01-01T00:00:00Z", origin: "grant" }),
      ],
      lessonProgress: [progressRow({ member_id: "mbr_AAAAAAAAAAA1", lesson_id: "les_AAAAAAAAAAA1", completed_at: "2026-10-01T00:00:00Z" })],
    });
    const data = await loadCourseRoster(createRepos(client), "crs_AAAAAAAAAAA1", NOW);
    expect(data!.course).toEqual({ id: "crs_AAAAAAAAAAA1", title: "Course" });
    expect(data!.rows.map((r) => ({ name: r.name, realName: r.realName, completed: r.completed, total: r.total }))).toEqual([
      { name: "Ada E", realName: "Ada Example", completed: 1, total: 1 },
      { name: "Bo Example", realName: undefined, completed: 0, total: 1 },
    ]);
  });

  it("reads past 1000 access and progress rows", async () => {
    const members = Array.from({ length: 1500 }, (_, i) => `mbr_${String(i).padStart(12, "A")}`);
    dataset = new InMemoryDataset({
      members: members.map((id) => ({ id, name: `Name ${id}` })),
      courses: [courseRow({ id: "crs_AAAAAAAAAAA1", slug: "course", title: "Course" })],
      courseLessons: [lessonRow({ id: "les_AAAAAAAAAAA1", course_id: "crs_AAAAAAAAAAA1", title: "One" })],
      courseAccess: members.map((m) => accessRow({ member_id: m, course_id: "crs_AAAAAAAAAAA1", starts_at: "2026-01-01T00:00:00Z" })),
      lessonProgress: members.map((m) => progressRow({ member_id: m, lesson_id: "les_AAAAAAAAAAA1", completed_at: "2026-10-01T00:00:00Z" })),
    });
    const data = await loadCourseRoster(createRepos(client), "crs_AAAAAAAAAAA1", NOW);
    expect(data!.rows).toHaveLength(1500);
    expect(data!.rows.every((r) => r.completed === 1 && r.total === 1)).toBe(true);
  });
});
