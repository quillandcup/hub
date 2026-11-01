import { describe, expect, it } from "vitest";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { createInMemoryRepos } from "@/lib/data/repos";
import { loadTakeOverPreview } from "@/lib/courses/take-over";
import { courseRow, fileRow, lessonRow, moduleRow } from "../helpers/course-fixtures";

const COURSE = "crs_AAAAAAAAAAA1";
const M1 = "mod_AAAAAAAAAAA1";
const M2 = "mod_AAAAAAAAAAA2";
const M3 = "mod_AAAAAAAAAAA3";
const L = (n: number) => `les_AAAAAAAAAAA${n}`;

const kajabi = { source: "kajabi", source_key: "k" };
const repos = (over: { modules?: ReturnType<typeof moduleRow>[]; lessons?: ReturnType<typeof lessonRow>[]; files?: ReturnType<typeof fileRow>[]; course?: Partial<Parameters<typeof courseRow>[0]> } = {}) =>
  createInMemoryRepos(
    new InMemoryDataset({
      courses: [courseRow({ id: COURSE, slug: "c", title: "C", ...kajabi, ...over.course })],
      courseModules: over.modules ?? [],
      courseLessons: over.lessons ?? [],
      courseLessonFiles: over.files ?? [],
    }),
  );

describe("loadTakeOverPreview", () => {
  it("counts what would move over and what has no setting yet, changing nothing", async () => {
    const r = repos({
      modules: [
        moduleRow({ id: M1, course_id: COURSE, title: "A", ...kajabi, publishing_option: "published" }),
        moduleRow({ id: M2, course_id: COURSE, parent_id: M1, title: "B", ...kajabi, publishing_option: null }),
      ],
      lessons: [
        lessonRow({ id: L(1), course_id: COURSE, module_id: M2, title: "One", ...kajabi, publishing_option: "published", excerpt: "Hello", video_id: "00000000-0000-4000-a000-000000000001" }),
        lessonRow({ id: L(2), course_id: COURSE, module_id: M2, title: "Two", ...kajabi, publishing_option: "weird" }),
        lessonRow({ id: L(3), course_id: COURSE, title: "Three", ...kajabi, publishing_option: "locked", excerpt: "Hi" }),
      ],
      files: [fileRow({ id: "file_AAAAAAAAAAA1", lesson_id: L(1), filename: "a.pdf" }), fileRow({ id: "file_AAAAAAAAAAA2", lesson_id: L(3), filename: "b.pdf" })],
    });

    expect(await loadTakeOverPreview(r, COURSE)).toEqual({ modules: 2, lessons: 3, withText: 2, withVideo: 1, downloads: 2, withoutSetting: 2, tooDeep: false });
    expect((await r.courses.courseById(COURSE))?.source).toBe("kajabi");
  });

  it("says when modules nest deeper than the editor does", async () => {
    const r = repos({
      modules: [
        moduleRow({ id: M1, course_id: COURSE, title: "A", ...kajabi }),
        moduleRow({ id: M2, course_id: COURSE, parent_id: M1, title: "B", ...kajabi }),
        moduleRow({ id: M3, course_id: COURSE, parent_id: M2, title: "C", ...kajabi }),
      ],
    });
    expect(await loadTakeOverPreview(r, COURSE)).toMatchObject({ tooDeep: true });
  });

  it("is empty for a course with nothing in it", async () => {
    expect(await loadTakeOverPreview(repos(), COURSE)).toEqual({ modules: 0, lessons: 0, withText: 0, withVideo: 0, downloads: 0, withoutSetting: 0, tooDeep: false });
  });

  it("has nothing to say about a course the Hub owns, or one that isn't there", async () => {
    expect(await loadTakeOverPreview(repos({ course: { source: "hub", source_key: null } }), COURSE)).toBeNull();
    expect(await loadTakeOverPreview(repos(), "crs_AAAAAAAAAAA9")).toBeNull();
  });
});
