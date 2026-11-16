import { describe, expect, it } from "vitest";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { createInMemoryRepos } from "@/lib/data/repos";
import { loadDuplicatePreview } from "@/lib/courses/duplicate";
import { loadAdminCourses } from "@/lib/courses/admin";
import { courseRow, fileRow, lessonRow, moduleRow } from "../helpers/course-fixtures";

const COURSE = "crs_AAAAAAAAAAA1";
const M1 = "mod_AAAAAAAAAAA1";
const M2 = "mod_AAAAAAAAAAA2";
const M3 = "mod_AAAAAAAAAAA3";
const L = (n: number) => `les_AAAAAAAAAAA${n}`;

const repos = (over: { modules?: ReturnType<typeof moduleRow>[]; lessons?: ReturnType<typeof lessonRow>[]; files?: ReturnType<typeof fileRow>[]; source?: string } = {}) =>
  createInMemoryRepos(
    new InMemoryDataset({
      courses: [courseRow({ id: COURSE, slug: "c", title: "C", source: over.source ?? "kajabi", source_key: over.source === "hub" ? null : "k" })],
      courseModules: over.modules ?? [],
      courseLessons: over.lessons ?? [],
      courseLessonFiles: over.files ?? [],
    }),
  );

describe("loadDuplicatePreview", () => {
  it("counts what the copy would get, changing nothing", async () => {
    const r = repos({
      modules: [moduleRow({ id: M1, course_id: COURSE, title: "A" }), moduleRow({ id: M2, course_id: COURSE, parent_id: M1, title: "B" })],
      lessons: [
        lessonRow({ id: L(1), course_id: COURSE, module_id: M2, title: "One", video_id: "00000000-0000-4000-a000-000000000001" }),
        lessonRow({ id: L(2), course_id: COURSE, title: "Two" }),
      ],
      files: [fileRow({ id: "file_AAAAAAAAAAA1", lesson_id: L(1), filename: "a.pdf" })],
    });
    expect(await loadDuplicatePreview(r, COURSE)).toEqual({ modules: 2, lessons: 2, withVideo: 1, downloads: 1, tooDeep: false });
    expect((await r.courses.courses()).length).toBe(1);
  });

  it("works for a course the Hub owns, and says when modules nest deeper than the editor does", async () => {
    const r = repos({
      source: "hub",
      modules: [
        moduleRow({ id: M1, course_id: COURSE, title: "A" }),
        moduleRow({ id: M2, course_id: COURSE, parent_id: M1, title: "B" }),
        moduleRow({ id: M3, course_id: COURSE, parent_id: M2, title: "C" }),
      ],
    });
    expect(await loadDuplicatePreview(r, COURSE)).toMatchObject({ modules: 3, tooDeep: true });
  });

  it("has nothing to say about a course that isn't there", async () => {
    expect(await loadDuplicatePreview(repos(), "crs_AAAAAAAAAAA9")).toBeNull();
  });
});

describe("a duplicated course in the admin list", () => {
  it("is listed on its own, a draft Hub course, beside the original that stays imported", async () => {
    const r = repos({ lessons: [lessonRow({ id: L(1), course_id: COURSE, title: "One", state: "open" })] });
    const copyId = await r.courses.duplicateCourse(COURSE);

    const rows = await loadAdminCourses({ ...r, kajabiCourses: { liveCourses: async () => [{ kajabi_id: "k", title: "C" }], liveModules: async () => [], liveLessonOutlines: async () => [] } } as never);
    expect(rows.map((c) => [c.id, c.source, c.isDraft])).toEqual(expect.arrayContaining([[copyId, "hub", true], [COURSE, "kajabi", false]]));
    expect(rows).toHaveLength(2);
  });
});
