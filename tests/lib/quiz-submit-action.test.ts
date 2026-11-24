import { beforeEach, describe, expect, it, vi } from "vitest";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { createInMemoryRepos } from "@/lib/data/repos";
import { courseRow, lessonRow } from "../helpers/course-fixtures";

const caller = vi.hoisted(() => ({ value: null as null | { userId: string; identity: { memberId: string; isSudo: boolean }; scope: { memberId: string; isAdminActing: boolean } } }));
const revalidatePath = vi.hoisted(() => vi.fn());
vi.mock("next/cache", () => ({ revalidatePath }));
vi.mock("@/lib/courses/caller", () => ({ getCoursesCaller: async () => caller.value }));
vi.mock("@/lib/analytics/server", () => ({ withAction: async (_id: string, run: () => Promise<unknown>) => run() }));
vi.mock("@/lib/supabase/service", () => ({ createServiceRoleClient: () => ({}) }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({}) }));
let dataset: InMemoryDataset;
vi.mock("@/lib/data/repos", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/data/repos")>()), createRepos: () => createInMemoryRepos(dataset) }));
const requireActionPermission = vi.hoisted(() => vi.fn());
vi.mock("@/lib/admin-auth", () => ({ requireActionPermission: (...a: unknown[]) => requireActionPermission(...a) }));

const { submitQuiz } = await import("@/app/(member)/courses/quiz-actions");
const { setLessonComplete, clearMyLessonProgress } = await import("@/app/(member)/courses/actions");

const COURSE = "crs_AAAAAAAAAAA1";
const LESSON = "les_AAAAAAAAAAA1";
const PLAIN = "les_AAAAAAAAAAA2";
const SOON = "les_AAAAAAAAAAA3";
const ADA = "mbr_AAAAAAAAAAA1";
const repos = () => createInMemoryRepos(dataset);
const asMember = (over: { isSudo?: boolean; isAdminActing?: boolean } = {}) => {
  caller.value = { userId: "11111111-1111-4111-8111-111111111111", identity: { memberId: ADA, isSudo: over.isSudo ?? false }, scope: { memberId: ADA, isAdminActing: over.isAdminActing ?? false } };
};

/** One question, the second answer is right. */
async function seed(settings: { passingPercent?: number } = {}) {
  const quiz = await repos().quizzes.createQuiz(LESSON, settings);
  const id = await repos().quizzes.saveQuestion(quiz.id, null, { prompt: "One?", allowsMultiple: false, options: [{ label: "a", isCorrect: false }, { label: "b", isCorrect: true }] });
  const options = (await repos().quizzes.questionsOf(quiz.id))[0].options;
  return { quiz, id, wrong: options[0].id, right: options[1].id };
}

beforeEach(() => {
  revalidatePath.mockClear();
  requireActionPermission.mockReset().mockResolvedValue({ ok: true });
  asMember();
  dataset = new InMemoryDataset({
    courses: [courseRow({ id: COURSE, slug: "c", title: "C" })],
    courseLessons: [lessonRow({ id: LESSON, course_id: COURSE, title: "Check in" }), lessonRow({ id: PLAIN, course_id: COURSE, title: "Plain", position: 2 }), lessonRow({ id: SOON, course_id: COURSE, title: "Soon", position: 3, state: "coming_soon" })],
    courseAccess: [{ member_id: ADA, course_id: COURSE, starts_at: "2020-01-01T00:00:00.000Z", ends_at: null, origin: "purchase" } as never],
  });
});

describe("submitQuiz", () => {
  it("scores the answers on the server, records the attempt, completes the lesson on a pass and returns the review", async () => {
    const { quiz, id, right } = await seed({ passingPercent: 100 });

    const result = await submitQuiz(LESSON, { [id]: [right] });

    expect(result).toMatchObject({ submission: { scorePercent: 100, passed: true, lessonComplete: true } });
    expect((await repos().quizzes.attemptsOf(ADA, quiz.id)).map((a) => a.passed)).toEqual([true]);
    expect(await repos().courseProgress.completedLessonIds(ADA, [LESSON])).toEqual(new Set([LESSON]));
    expect(revalidatePath).toHaveBeenCalledWith("/courses", "layout");
  });

  it("records a failed attempt and leaves the lesson open", async () => {
    const { quiz, id, wrong } = await seed({ passingPercent: 100 });
    const result = await submitQuiz(LESSON, { [id]: [wrong] });
    expect(result).toMatchObject({ submission: { scorePercent: 0, passed: false, lessonComplete: false } });
    expect((await repos().quizzes.attemptsOf(ADA, quiz.id)).map((a) => a.passed)).toEqual([false]);
    expect(await repos().courseProgress.completedLessonIds(ADA, [LESSON])).toEqual(new Set());
  });

  it("refuses everything it shouldn't, recording nothing", async () => {
    const { quiz, id, right } = await seed();
    const ok = { [id]: [right] };

    expect(await submitQuiz("nope", ok)).toEqual({ error: "Lesson not found" });
    expect(await submitQuiz(LESSON, "nope" as never)).toEqual({ error: "Those answers couldn't be read. Reload the page and try again." });
    expect(await submitQuiz(LESSON, { [id]: [1] } as never)).toEqual({ error: "Those answers couldn't be read. Reload the page and try again." });
    expect(await submitQuiz("les_AAAAAAAAAAA9", ok)).toEqual({ error: "Lesson not found" });
    // A lesson members can't open yet, even for staff previewing it.
    expect(await submitQuiz(SOON, ok)).toEqual({ error: "Lesson not found" });
    asMember({ isAdminActing: true });
    expect(await submitQuiz(SOON, ok)).toEqual({ error: "Lesson not found" });
    asMember();
    // A lesson that isn't a quiz.
    expect(await submitQuiz(PLAIN, ok)).toEqual({ error: "This isn't a quiz." });
    // Signed out, and sudo (read-only).
    caller.value = null;
    expect(await submitQuiz(LESSON, ok)).toEqual({ error: "Not available" });
    asMember({ isSudo: true });
    expect(await submitQuiz(LESSON, ok)).toEqual({ error: "Quizzes can't be taken while viewing as a member" });

    expect(await repos().quizzes.attemptsOfQuiz(quiz.id)).toEqual([]);
    expect(await repos().courseProgress.completedLessonIds(ADA, [LESSON])).toEqual(new Set());
  });

  it("refuses a member without access to the course, and one whose access has ended", async () => {
    const { quiz, id, right } = await seed();
    dataset.courseAccess = [];
    expect(await submitQuiz(LESSON, { [id]: [right] })).toEqual({ error: "You don't have access to this course" });
    dataset.courseAccess = [{ member_id: ADA, course_id: COURSE, starts_at: "2020-01-01T00:00:00.000Z", ends_at: "2021-01-01T00:00:00.000Z", origin: "purchase" } as never];
    expect(await submitQuiz(LESSON, { [id]: [right] })).toEqual({ error: "You don't have access to this course" });
    expect(await repos().quizzes.attemptsOfQuiz(quiz.id)).toEqual([]);
  });

  it("refuses a quiz with no questions yet", async () => {
    await repos().quizzes.createQuiz(LESSON);
    expect(await submitQuiz(LESSON, {})).toEqual({ error: "This quiz has no questions yet." });
  });

  it("reports a failed save without leaking the database message", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { id, right } = await seed();
    const original = dataset.quizAttempts;
    Object.defineProperty(dataset, "quizAttempts", { get: () => { throw new Error("connection string leaked"); }, configurable: true });
    const result = await submitQuiz(LESSON, { [id]: [right] });
    Object.defineProperty(dataset, "quizAttempts", { value: original, writable: true, configurable: true });
    expect(result).toEqual({ error: "Couldn't save your answers. Try again." });
    spy.mockRestore();
  });
});

describe("a quiz lesson is not completed by a click", () => {
  it("setLessonComplete refuses it, and still works for a plain lesson", async () => {
    await seed();
    expect(await setLessonComplete(LESSON, true)).toEqual({ error: "This lesson is completed by passing its quiz" });
    expect(await repos().courseProgress.completedLessonIds(ADA, [LESSON])).toEqual(new Set());
    expect(await setLessonComplete(PLAIN, true)).toEqual({});
    expect(await repos().courseProgress.completedLessonIds(ADA, [PLAIN])).toEqual(new Set([PLAIN]));
  });

  it("clearMyLessonProgress also clears the staff member's own quiz attempts, and nobody else's", async () => {
    const { quiz, id, right } = await seed({ passingPercent: 100 });
    asMember({ isAdminActing: true });
    await submitQuiz(LESSON, { [id]: [right] });
    await repos().quizzes.recordAttempt({ quizId: quiz.id, memberId: "mbr_AAAAAAAAAAA2", questionCount: 1, correctCount: 0, scorePercent: 0, passed: false, answers: [] });
    expect(await repos().courseProgress.completedLessonIds(ADA, [LESSON])).toEqual(new Set([LESSON]));

    expect(await clearMyLessonProgress(LESSON)).toEqual({ segments: 0 });

    expect(await repos().quizzes.attemptsOf(ADA, quiz.id)).toEqual([]);
    expect(await repos().courseProgress.completedLessonIds(ADA, [LESSON])).toEqual(new Set());
    expect((await repos().quizzes.attemptsOf("mbr_AAAAAAAAAAA2", quiz.id)).length).toBe(1);
  });
});
