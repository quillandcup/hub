import { beforeEach, describe, expect, it, vi } from "vitest";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { createInMemoryRepos } from "@/lib/data/repos";
import { courseRow, lessonRow, moduleRow } from "../helpers/course-fixtures";

const admin = vi.hoisted(() => ({ result: { ok: true, supabase: {} } as { ok: true; supabase: object } }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/admin-auth", () => ({ requireActionPermission: async () => admin.result }));
vi.mock("@/lib/analytics/server", () => ({ withAction: async (_id: string, run: () => Promise<unknown>) => run() }));
let dataset: InMemoryDataset;
const duplicateItem = vi.hoisted(() => vi.fn());
const duplicateCourseRpc = vi.hoisted(() => vi.fn());
vi.mock("@/lib/data/repos", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/data/repos")>()),
  createRepos: () => {
    const repos = createInMemoryRepos(dataset);
    // The copy itself is a database function (supabase/tests/database/duplicate_course.test.sql covers what it copies);
    // what is tested here is that the actions reach it for what holds a quiz.
    return { ...repos, courses: Object.assign(Object.create(repos.courses), { duplicateItem, duplicateCourse: duplicateCourseRpc }) };
  },
}));

const { duplicateCourseItem } = await import("@/app/(admin)/admin/courses/outline-actions");
const { duplicateCourse } = await import("@/app/(admin)/admin/courses/duplicate-actions");

const COURSE = "crs_AAAAAAAAAAA1";
const MODULE = "mod_AAAAAAAAAAA1";
const QUIZ_LESSON = "les_AAAAAAAAAAA1";

beforeEach(async () => {
  duplicateItem.mockReset().mockResolvedValue("les_AAAAAAAAAAA9");
  duplicateCourseRpc.mockReset().mockResolvedValue("crs_AAAAAAAAAAA9");
  dataset = new InMemoryDataset({
    courses: [courseRow({ id: COURSE, slug: "c", title: "C", source: "hub", source_key: null })],
    courseModules: [moduleRow({ id: MODULE, course_id: COURSE, title: "Week 1" })],
    courseLessons: [lessonRow({ id: QUIZ_LESSON, course_id: COURSE, module_id: MODULE, title: "Check in" })],
  });
  await createInMemoryRepos(dataset).quizzes.createQuiz(QUIZ_LESSON);
});

describe("duplicating what holds a quiz", () => {
  it("copies a quiz lesson and a module that holds one (the database functions carry the quiz)", async () => {
    expect(await duplicateCourseItem(COURSE, "lesson", QUIZ_LESSON)).toEqual({ id: "les_AAAAAAAAAAA9" });
    expect(duplicateItem).toHaveBeenCalledWith("lesson", QUIZ_LESSON);
    expect(await duplicateCourseItem(COURSE, "module", MODULE)).toEqual({ id: "les_AAAAAAAAAAA9" });
    expect(duplicateItem).toHaveBeenCalledWith("module", MODULE);
  });

  it("copies a course that holds a quiz", async () => {
    expect(await duplicateCourse(COURSE)).toEqual({ id: "crs_AAAAAAAAAAA9" });
    expect(duplicateCourseRpc).toHaveBeenCalledWith(COURSE);
  });
});
