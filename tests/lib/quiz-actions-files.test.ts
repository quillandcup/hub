import { beforeEach, describe, expect, it, vi } from "vitest";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { createInMemoryRepos } from "@/lib/data/repos";
import { courseRow, lessonRow, moduleRow } from "../helpers/course-fixtures";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/admin-auth", () => ({ requireActionPermission: async () => ({ ok: true, supabase: {} }) }));
vi.mock("@/lib/analytics/server", () => ({ withAction: async (_id: string, run: () => Promise<unknown>) => run() }));
vi.mock("@/lib/supabase/service", () => ({ createServiceRoleClient: () => ({ marker: "service" }) }));
let dataset: InMemoryDataset;
vi.mock("@/lib/data/repos", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/data/repos")>()), createRepos: () => createInMemoryRepos(dataset) }));
const storage = vi.hoisted(() => ({ removeQuizFiles: vi.fn(async (_c: unknown, paths: string[]) => paths.length) }));
vi.mock("@/lib/courses/quiz-files-storage", () => storage);

const { saveQuizQuestion, deleteQuizQuestion, removeQuiz } = await import("@/app/(admin)/admin/courses/quiz-actions");

const COURSE = "crs_AAAAAAAAAAA1";
const MODULE = "mod_AAAAAAAAAAA1";
const LESSON = "les_AAAAAAAAAAA1";
const ADA = "mbr_AAAAAAAAAAA1";
const repos = () => createInMemoryRepos(dataset);

beforeEach(() => {
  storage.removeQuizFiles.mockClear();
  dataset = new InMemoryDataset({
    courses: [courseRow({ id: COURSE, slug: "c", title: "C", source: "hub", source_key: null })],
    courseModules: [moduleRow({ id: MODULE, course_id: COURSE, title: "Week 1" })],
    courseLessons: [lessonRow({ id: LESSON, course_id: COURSE, module_id: MODULE, title: "Reflect" })],
  });
});

async function withUploads() {
  const quiz = await repos().quizzes.createQuiz(LESSON);
  const file = await repos().quizzes.saveQuestion(quiz.id, null, { prompt: "Upload", kind: "file_upload", graded: false, allowsMultiple: false, options: [] });
  const other = await repos().quizzes.saveQuestion(quiz.id, null, { prompt: "Upload more", kind: "file_upload", graded: false, allowsMultiple: false, options: [] });
  const attempt = (questionId: string, name: string) =>
    repos().quizzes.recordAttempt({ quizId: quiz.id, memberId: ADA, questionCount: 0, correctCount: 0, scorePercent: 0, passed: true, answers: [{ questionId, selectedOptionIds: [], isCorrect: null, file: { path: `${ADA}/x/${name}`, name, bytes: 1 } }] });
  await attempt(file, "a.pdf");
  await attempt(file, "b.pdf");
  await attempt(other, "c.pdf");
  return { quiz, file, other };
}

describe("saving a question of another kind", () => {
  it("saves a short answer question, and says what a bad one needs", async () => {
    await repos().quizzes.createQuiz(LESSON);
    expect(await saveQuizQuestion(COURSE, LESSON, null, { prompt: "Why?", kind: "short_answer", graded: false, allowsMultiple: false, options: [] })).toMatchObject({ id: expect.any(String) });
    expect(await saveQuizQuestion(COURSE, LESSON, null, { prompt: "", kind: "short_answer", graded: false, allowsMultiple: false, options: [] })).toEqual({ error: "Write the question." });
  });

  it("refuses to change the kind of a question that exists", async () => {
    const quiz = await repos().quizzes.createQuiz(LESSON);
    const id = await repos().quizzes.saveQuestion(quiz.id, null, { prompt: "Why?", kind: "short_answer", graded: false, allowsMultiple: false, options: [] });
    const result = await saveQuizQuestion(COURSE, LESSON, id, { prompt: "Why?", kind: "file_upload", graded: false, allowsMultiple: false, options: [] });
    expect(result.error).toMatch(/isn't complete/);
  });
});

describe("deleting what members uploaded", () => {
  it("deletes a question's files from storage once the question is gone, and no one else's", async () => {
    const { file } = await withUploads();
    expect(await deleteQuizQuestion(COURSE, LESSON, file)).toEqual({ id: file });
    expect(storage.removeQuizFiles).toHaveBeenCalledTimes(1);
    expect((storage.removeQuizFiles.mock.calls[0][1] as string[]).sort()).toEqual([`${ADA}/x/a.pdf`, `${ADA}/x/b.pdf`]);
  });

  it("deletes every file of the quiz when the quiz is removed", async () => {
    await withUploads();
    expect(await removeQuiz(COURSE, LESSON)).toEqual({ id: LESSON });
    expect((storage.removeQuizFiles.mock.calls[0][1] as string[]).sort()).toEqual([`${ADA}/x/a.pdf`, `${ADA}/x/b.pdf`, `${ADA}/x/c.pdf`]);
  });

  it("keeps the files when the question can't be deleted", async () => {
    await withUploads();
    expect(await deleteQuizQuestion(COURSE, LESSON, "qques_AAAAAAAAAAAa")).toMatchObject({ error: expect.any(String) });
    expect(storage.removeQuizFiles).not.toHaveBeenCalled();
  });
});
