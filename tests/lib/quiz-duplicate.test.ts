import { beforeEach, describe, expect, it, vi } from "vitest";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { createInMemoryRepos } from "@/lib/data/repos";
import { duplicateBlockedByQuizzes } from "@/lib/courses/quiz-duplicate";
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
    // The copy itself is a database function the in-memory twin doesn't have; what is tested is that it is (not) reached.
    return { ...repos, courses: Object.assign(Object.create(repos.courses), { duplicateItem, duplicateCourse: duplicateCourseRpc }) };
  },
}));

const { duplicateCourseItem } = await import("@/app/(admin)/admin/courses/outline-actions");
const { duplicateCourse } = await import("@/app/(admin)/admin/courses/duplicate-actions");

const COURSE = "crs_AAAAAAAAAAA1";
const MODULE = "mod_AAAAAAAAAAA1";
const QUIZ_LESSON = "les_AAAAAAAAAAA1";
const PLAIN_LESSON = "les_AAAAAAAAAAA2";

beforeEach(async () => {
  duplicateItem.mockReset().mockResolvedValue("les_AAAAAAAAAAA9");
  duplicateCourseRpc.mockReset().mockResolvedValue("crs_AAAAAAAAAAA9");
  dataset = new InMemoryDataset({
    courses: [courseRow({ id: COURSE, slug: "c", title: "C", source: "hub", source_key: null })],
    courseModules: [moduleRow({ id: MODULE, course_id: COURSE, title: "Week 1" })],
    courseLessons: [lessonRow({ id: QUIZ_LESSON, course_id: COURSE, module_id: MODULE, title: "Check in" }), lessonRow({ id: PLAIN_LESSON, course_id: COURSE, module_id: MODULE, title: "Plain" })],
  });
  await createInMemoryRepos(dataset).quizzes.createQuiz(QUIZ_LESSON);
});

describe("duplicateBlockedByQuizzes", () => {
  const repos = () => createInMemoryRepos(dataset);

  it("says nothing when no lesson is a quiz, or there are no lessons", async () => {
    expect(await duplicateBlockedByQuizzes(repos(), [PLAIN_LESSON], "lesson")).toBeNull();
    expect(await duplicateBlockedByQuizzes(repos(), [], "course")).toBeNull();
  });

  it("says why a lesson, a module or a course holding a quiz can't be copied yet", async () => {
    expect(await duplicateBlockedByQuizzes(repos(), [QUIZ_LESSON], "lesson")).toMatch(/A quiz can't be duplicated yet/);
    expect(await duplicateBlockedByQuizzes(repos(), [QUIZ_LESSON, PLAIN_LESSON], "module")).toBe("This module holds a quiz, and a copy would leave it empty, so it can't be duplicated yet.");
    await repos().quizzes.createQuiz(PLAIN_LESSON);
    expect(await duplicateBlockedByQuizzes(repos(), [QUIZ_LESSON, PLAIN_LESSON], "course")).toBe("This course holds 2 quizzes, and a copy would leave them empty, so it can't be duplicated yet.");
  });
});

describe("duplicating what holds a quiz", () => {
  it("refuses a quiz lesson and a module that holds one, without copying anything", async () => {
    expect((await duplicateCourseItem(COURSE, "lesson", QUIZ_LESSON)).error).toMatch(/quiz can't be duplicated yet/);
    expect((await duplicateCourseItem(COURSE, "module", MODULE)).error).toMatch(/This module holds a quiz/);
    expect(duplicateItem).not.toHaveBeenCalled();
  });

  it("still copies a plain lesson", async () => {
    expect(await duplicateCourseItem(COURSE, "lesson", PLAIN_LESSON)).toEqual({ id: "les_AAAAAAAAAAA9" });
    expect(duplicateItem).toHaveBeenCalledWith("lesson", PLAIN_LESSON);
  });

  it("refuses a course that holds a quiz, and copies one that doesn't", async () => {
    expect((await duplicateCourse(COURSE)).error).toMatch(/This course holds a quiz/);
    expect(duplicateCourseRpc).not.toHaveBeenCalled();
    dataset.quizzes = [];
    expect(await duplicateCourse(COURSE)).toEqual({ id: "crs_AAAAAAAAAAA9" });
  });
});
