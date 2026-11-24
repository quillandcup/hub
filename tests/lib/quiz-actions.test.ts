import { beforeEach, describe, expect, it, vi } from "vitest";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { createInMemoryRepos } from "@/lib/data/repos";
import type { QuestionDraft } from "@/lib/courses/quiz-editor";
import { courseRow, lessonRow, moduleRow } from "../helpers/course-fixtures";

const admin = vi.hoisted(() => ({ result: { ok: true, supabase: {} } as { ok: true; supabase: object } | { ok: false; error: string } }));
const revalidatePath = vi.hoisted(() => vi.fn());
vi.mock("next/cache", () => ({ revalidatePath }));
vi.mock("@/lib/admin-auth", () => ({ requireActionPermission: async () => admin.result }));
vi.mock("@/lib/analytics/server", () => ({ withAction: async (_id: string, run: () => Promise<unknown>) => run() }));
let dataset: InMemoryDataset;
vi.mock("@/lib/data/repos", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/data/repos")>()), createRepos: () => createInMemoryRepos(dataset) }));

const { addQuizLesson, saveQuizQuestion, deleteQuizQuestion, reorderQuizQuestions, saveQuizSettings, removeQuiz } = await import("@/app/(admin)/admin/courses/quiz-actions");

const COURSE = "crs_AAAAAAAAAAA1";
const KAJABI_COURSE = "crs_AAAAAAAAAAA2";
const MODULE = "mod_AAAAAAAAAAA1";
const LESSON = "les_AAAAAAAAAAA1";
const KAJABI_LESSON = "les_AAAAAAAAAAA2";
const repos = () => createInMemoryRepos(dataset);

const question = (over: Partial<QuestionDraft> = {}): QuestionDraft => ({
  prompt: "How are you?",
  allowsMultiple: false,
  options: [{ label: "Fine", isCorrect: true }, { label: "Tired", isCorrect: false }],
  ...over,
});

beforeEach(() => {
  revalidatePath.mockClear();
  admin.result = { ok: true, supabase: {} };
  dataset = new InMemoryDataset({
    courses: [courseRow({ id: COURSE, slug: "c", title: "C", source: "hub", source_key: null }), courseRow({ id: KAJABI_COURSE, slug: "k", title: "K", source: "kajabi", source_key: "k" })],
    courseModules: [moduleRow({ id: MODULE, course_id: COURSE, title: "Week 1" })],
    courseLessons: [lessonRow({ id: LESSON, course_id: COURSE, module_id: MODULE, title: "Check in" }), lessonRow({ id: KAJABI_LESSON, course_id: KAJABI_COURSE, title: "Imported check in", source: "kajabi", source_key: "kl" })],
  });
});

/** A quiz lesson that is already a quiz, in each course. */
const makeQuizzes = async () => {
  const quiz = await repos().quizzes.createQuiz(LESSON);
  const imported = await repos().quizzes.createQuiz(KAJABI_LESSON);
  return { quiz, imported };
};

describe("addQuizLesson", () => {
  it("adds a draft lesson to the module and makes it a quiz", async () => {
    const result = await addQuizLesson(COURSE, MODULE, "  Let's check in ");
    expect(result.error).toBeUndefined();
    const lesson = (await repos().courses.lessonsOf([COURSE], { includeHidden: true })).find((l) => l.id === result.id)!;
    expect(lesson).toMatchObject({ title: "Let's check in", module_id: MODULE, publishing_option: "draft", source: "hub" });
    expect(await repos().quizzes.quizOfLesson(result.id!)).toMatchObject({ passingPercent: null, hideAnswers: false });
    expect(revalidatePath).toHaveBeenCalledWith(`/admin/courses/${COURSE}`, "layout");
  });

  it("refuses without the permission, with bad ids and with a blank name, writing nothing", async () => {
    admin.result = { ok: false, error: "Forbidden" };
    expect(await addQuizLesson(COURSE, MODULE, "Quiz")).toEqual({ error: "Forbidden" });
    admin.result = { ok: true, supabase: {} };
    expect(await addQuizLesson("nope", MODULE, "Quiz")).toEqual({ error: "Course not found." });
    expect(await addQuizLesson(COURSE, "nope", "Quiz")).toEqual({ error: "Course not found." });
    expect((await addQuizLesson(COURSE, MODULE, "   ")).error).toBeTruthy();
    expect((await repos().courses.lessonsOf([COURSE], { includeHidden: true })).length).toBe(1);
  });

  it("takes the new lesson back when the quiz can't be made, so no plain lesson is left behind", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const original = dataset.quizzes;
    // The quiz table refuses (a made-up failure): the lesson that was just added must not stay.
    Object.defineProperty(dataset, "quizzes", { get: () => { throw new Error("boom"); }, configurable: true });
    const result = await addQuizLesson(COURSE, MODULE, "Quiz");
    Object.defineProperty(dataset, "quizzes", { value: original, writable: true, configurable: true });
    expect(result.error).toBe("Couldn't add the quiz.");
    expect((await repos().courses.lessonsOf([COURSE], { includeHidden: true })).map((l) => l.id)).toEqual([LESSON]);
    spy.mockRestore();
  });
});

describe("saveQuizQuestion", () => {
  it("saves a new question, then edits it", async () => {
    const { quiz } = await makeQuizzes();
    const added = await saveQuizQuestion(COURSE, LESSON, null, question());
    expect(added.id).toMatch(/^qques_/);
    expect((await repos().quizzes.questionsOf(quiz.id)).map((q) => q.prompt)).toEqual(["How are you?"]);

    const edited = await saveQuizQuestion(COURSE, LESSON, added.id!, question({ prompt: "How are you today?" }));
    expect(edited).toEqual({ id: added.id });
    expect((await repos().quizzes.questionsOf(quiz.id)).map((q) => q.prompt)).toEqual(["How are you today?"]);
  });

  it("refuses a question that isn't whole, in the form's words, before touching the database", async () => {
    const { quiz } = await makeQuizzes();
    expect(await saveQuizQuestion(COURSE, LESSON, null, question({ prompt: " " }))).toEqual({ error: "Write the question." });
    expect(await saveQuizQuestion(COURSE, LESSON, null, question({ options: [{ label: "A", isCorrect: false }, { label: "B", isCorrect: false }] }))).toEqual({ error: "Mark the right answer." });
    expect(await repos().quizzes.questionsOf(quiz.id)).toEqual([]);
  });

  it("refuses a quiz imported from Kajabi, a lesson of another course, a plain lesson and a bad question id", async () => {
    await makeQuizzes();
    expect((await saveQuizQuestion(KAJABI_COURSE, KAJABI_LESSON, null, question())).error).toMatch(/imported from Kajabi|isn't in the Hub/);
    expect(await saveQuizQuestion(KAJABI_COURSE, LESSON, null, question())).toEqual({ error: "Not found." });
    expect(await saveQuizQuestion(COURSE, "les_AAAAAAAAAAA9", null, question())).toEqual({ error: "Not found." });
    expect(await saveQuizQuestion(COURSE, LESSON, "qopt_AAAAAAAAAAA1", question())).toEqual({ error: "Not found." });
    dataset.quizzes = [];
    expect(await saveQuizQuestion(COURSE, LESSON, null, question())).toEqual({ error: "That lesson isn't a quiz." });
  });

  it("refuses without the permission", async () => {
    admin.result = { ok: false, error: "Forbidden" };
    expect(await saveQuizQuestion(COURSE, LESSON, null, question())).toEqual({ error: "Forbidden" });
  });
});

describe("deleteQuizQuestion and reorderQuizQuestions", () => {
  it("deletes a question and puts the rest in a new order", async () => {
    const { quiz } = await makeQuizzes();
    const a = (await saveQuizQuestion(COURSE, LESSON, null, question({ prompt: "A" }))).id!;
    const b = (await saveQuizQuestion(COURSE, LESSON, null, question({ prompt: "B" }))).id!;
    const c = (await saveQuizQuestion(COURSE, LESSON, null, question({ prompt: "C" }))).id!;

    expect(await reorderQuizQuestions(COURSE, LESSON, [c, a, b])).toEqual({ id: LESSON });
    expect((await repos().quizzes.questionsOf(quiz.id)).map((q) => q.prompt)).toEqual(["C", "A", "B"]);

    expect(await deleteQuizQuestion(COURSE, LESSON, a)).toEqual({ id: a });
    expect((await repos().quizzes.questionsOf(quiz.id)).map((q) => q.prompt)).toEqual(["C", "B"]);
  });

  it("says a stale list is stale, and a deleted question is gone", async () => {
    await makeQuizzes();
    const a = (await saveQuizQuestion(COURSE, LESSON, null, question({ prompt: "A" }))).id!;
    await saveQuizQuestion(COURSE, LESSON, null, question({ prompt: "B" }));
    expect((await reorderQuizQuestions(COURSE, LESSON, [a])).error).toMatch(/changed since you opened/);
    expect(await reorderQuizQuestions(COURSE, LESSON, [])).toEqual({ error: "Not found." });
    expect(await reorderQuizQuestions(COURSE, LESSON, ["nope"])).toEqual({ error: "Not found." });
    await deleteQuizQuestion(COURSE, LESSON, a);
    expect((await deleteQuizQuestion(COURSE, LESSON, a)).error).toMatch(/has been deleted/);
  });
});

describe("saveQuizSettings", () => {
  it("sets the passing grade and hides the answers, or clears the grade", async () => {
    const { quiz } = await makeQuizzes();
    expect(await saveQuizSettings(COURSE, LESSON, { passingPercent: "80", hideAnswers: true })).toEqual({ id: LESSON });
    expect(await repos().quizzes.quizOfLesson(LESSON)).toMatchObject({ id: quiz.id, passingPercent: 80, hideAnswers: true });
    await saveQuizSettings(COURSE, LESSON, { passingPercent: "", hideAnswers: false });
    expect(await repos().quizzes.quizOfLesson(LESSON)).toMatchObject({ passingPercent: null, hideAnswers: false });
  });

  it("refuses a grade that isn't a whole percent from 1 to 100, and an imported quiz", async () => {
    await makeQuizzes();
    expect(await saveQuizSettings(COURSE, LESSON, { passingPercent: "101", hideAnswers: false })).toEqual({ error: "Use a whole number from 1 to 100." });
    expect(await saveQuizSettings(COURSE, LESSON, { passingPercent: "abc", hideAnswers: false })).toEqual({ error: "Use a whole number from 1 to 100." });
    expect((await saveQuizSettings(KAJABI_COURSE, KAJABI_LESSON, { passingPercent: "70", hideAnswers: false })).error).toMatch(/imported from Kajabi|isn't in the Hub/);
    expect(await repos().quizzes.quizOfLesson(LESSON)).toMatchObject({ passingPercent: null });
  });
});

describe("removeQuiz", () => {
  it("takes the quiz, its questions and its attempts off the lesson and leaves the lesson", async () => {
    const { quiz } = await makeQuizzes();
    await saveQuizQuestion(COURSE, LESSON, null, question());
    await repos().quizzes.recordAttempt({ quizId: quiz.id, memberId: "mbr_AAAAAAAAAAA1", questionCount: 1, correctCount: 1, scorePercent: 100, passed: true, answers: [] });

    expect(await removeQuiz(COURSE, LESSON)).toEqual({ id: LESSON });

    expect(await repos().quizzes.quizOfLesson(LESSON)).toBeNull();
    expect(await repos().quizzes.attemptsOfQuiz(quiz.id)).toEqual([]);
    expect(await repos().courses.lessonById(LESSON)).not.toBeNull();
    expect(await removeQuiz(COURSE, LESSON)).toEqual({ error: "That lesson isn't a quiz." });
  });

  it("refuses an imported quiz and someone without the permission", async () => {
    await makeQuizzes();
    expect((await removeQuiz(KAJABI_COURSE, KAJABI_LESSON)).error).toMatch(/imported from Kajabi|isn't in the Hub/);
    admin.result = { ok: false, error: "Forbidden" };
    expect(await removeQuiz(COURSE, LESSON)).toEqual({ error: "Forbidden" });
  });
});
