import { beforeEach, describe, expect, it, vi } from "vitest";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { createInMemoryRepos } from "@/lib/data/repos";
import { isOwnQuizFilePath } from "@/lib/courses/quiz-files";
import { courseRow, lessonRow } from "../helpers/course-fixtures";

const caller = vi.hoisted(() => ({ value: null as null | { userId: string; identity: { memberId: string; isSudo: boolean }; scope: { memberId: string; isAdminActing: boolean } } }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/courses/caller", () => ({ getCoursesCaller: async () => caller.value }));
vi.mock("@/lib/analytics/server", () => ({ withAction: async (_id: string, run: () => Promise<unknown>) => run() }));
vi.mock("@/lib/supabase/service", () => ({ createServiceRoleClient: () => ({ marker: "service" }) }));
let dataset: InMemoryDataset;
vi.mock("@/lib/data/repos", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/data/repos")>()), createRepos: () => createInMemoryRepos(dataset) }));
const storage = vi.hoisted(() => ({ signQuizFileUpload: vi.fn(), quizFileSize: vi.fn() }));
vi.mock("@/lib/courses/quiz-files-storage", () => storage);

const { prepareQuizFileUpload, submitQuiz } = await import("@/app/(member)/courses/quiz-actions");

const COURSE = "crs_AAAAAAAAAAA1";
const LESSON = "les_AAAAAAAAAAA1";
const SOON = "les_AAAAAAAAAAA3";
const ADA = "mbr_AAAAAAAAAAA1";
const repos = () => createInMemoryRepos(dataset);
const asMember = (over: { isSudo?: boolean } = {}) => {
  caller.value = { userId: "11111111-1111-4111-8111-111111111111", identity: { memberId: ADA, isSudo: over.isSudo ?? false }, scope: { memberId: ADA, isAdminActing: false } };
};

async function seed() {
  const quiz = await repos().quizzes.createQuiz(LESSON);
  const file = await repos().quizzes.saveQuestion(quiz.id, null, { prompt: "Upload", kind: "file_upload", graded: false, allowsMultiple: false, options: [] });
  const text = await repos().quizzes.saveQuestion(quiz.id, null, { prompt: "Write", kind: "short_answer", graded: false, allowsMultiple: false, options: [] });
  return { quiz, file, text };
}

beforeEach(() => {
  storage.signQuizFileUpload.mockReset().mockResolvedValue({ token: "tok" });
  storage.quizFileSize.mockReset().mockResolvedValue({ bytes: 4096 });
  asMember();
  dataset = new InMemoryDataset({
    courses: [courseRow({ id: COURSE, slug: "c", title: "C" })],
    courseLessons: [lessonRow({ id: LESSON, course_id: COURSE, title: "Reflect" }), lessonRow({ id: SOON, course_id: COURSE, title: "Soon", position: 3, state: "coming_soon" })],
    courseAccess: [{ member_id: ADA, course_id: COURSE, starts_at: "2020-01-01T00:00:00.000Z", ends_at: null, origin: "purchase" } as never],
  });
});

describe("prepareQuizFileUpload", () => {
  it("signs one path in the member's own folder for a file question", async () => {
    const { file } = await seed();
    const result = await prepareQuizFileUpload(LESSON, file, { name: "My Letter.pdf", size: 5000 });
    expect(result.token).toBe("tok");
    expect(isOwnQuizFilePath(ADA, result.path)).toBe(true);
    expect(result.path).toMatch(/\/My_Letter\.pdf$/);
    expect(storage.signQuizFileUpload).toHaveBeenCalledWith({ marker: "service" }, result.path);
  });

  it("refuses a question that doesn't take a file, a bad file, a bad id, and people who may not answer", async () => {
    const { file, text } = await seed();
    expect(await prepareQuizFileUpload(LESSON, text, { name: "a.pdf", size: 10 })).toEqual({ error: "That question doesn't take a file." });
    expect(await prepareQuizFileUpload(LESSON, "qques_AAAAAAAAAAA9", { name: "a.pdf", size: 10 })).toEqual({ error: "That question doesn't take a file." });
    expect(await prepareQuizFileUpload(LESSON, file, { name: "run.exe", size: 10 })).toMatchObject({ error: expect.stringMatching(/document or a picture/) });
    expect(await prepareQuizFileUpload(LESSON, file, { name: "a.pdf", size: 10 * 1024 * 1024 + 1 })).toMatchObject({ error: expect.stringMatching(/10 MB/) });
    expect(await prepareQuizFileUpload(LESSON, "nope", { name: "a.pdf", size: 10 })).toEqual({ error: "That file can't be uploaded." });
    expect(await prepareQuizFileUpload("nope", file, { name: "a.pdf", size: 10 })).toEqual({ error: "Lesson not found" });
    expect(await prepareQuizFileUpload(SOON, file, { name: "a.pdf", size: 10 })).toEqual({ error: "Lesson not found" });
    asMember({ isSudo: true });
    expect(await prepareQuizFileUpload(LESSON, file, { name: "a.pdf", size: 10 })).toMatchObject({ error: expect.stringMatching(/viewing as a member/) });
    caller.value = null;
    expect(await prepareQuizFileUpload(LESSON, file, { name: "a.pdf", size: 10 })).toEqual({ error: "Not available" });
    expect(storage.signQuizFileUpload).not.toHaveBeenCalled();
  });

  it("refuses a member without access to the course", async () => {
    const { file } = await seed();
    dataset.courseAccess.length = 0;
    expect(await prepareQuizFileUpload(LESSON, file, { name: "a.pdf", size: 10 })).toEqual({ error: "You don't have access to this course" });
  });

  it("says so when storage can't sign", async () => {
    const { file } = await seed();
    storage.signQuizFileUpload.mockResolvedValue(null);
    expect(await prepareQuizFileUpload(LESSON, file, { name: "a.pdf", size: 10 })).toEqual({ error: "Couldn't start the upload. Try again." });
  });
});

describe("submitQuiz with a file", () => {
  it("checks the file in storage and records it with the size storage reports", async () => {
    const { quiz, file, text } = await seed();
    const path = `${ADA}/11111111-1111-4111-8111-111111111111/letter.pdf`;
    const result = await submitQuiz(LESSON, { texts: { [text]: "hello" }, files: { [file]: { path, name: "letter.pdf", bytes: 1 } } });
    expect(result).toMatchObject({ submission: { scored: false, passed: true, lessonComplete: true } });
    expect(storage.quizFileSize).toHaveBeenCalledWith({ marker: "service" }, path);
    const [attempt] = await repos().quizzes.attemptsOf(ADA, quiz.id);
    expect((await repos().quizzes.answersOf(attempt.id)).find((a) => a.questionId === file)?.file).toEqual({ path, name: "letter.pdf", bytes: 4096 });
  });

  it("refuses a file that isn't in storage, and a body that can't be read", async () => {
    const { quiz, file } = await seed();
    storage.quizFileSize.mockResolvedValue(null);
    const path = `${ADA}/11111111-1111-4111-8111-111111111111/letter.pdf`;
    expect(await submitQuiz(LESSON, { files: { [file]: { path, name: "letter.pdf", bytes: 1 } } })).toEqual({ error: "One of your files couldn't be found. Upload it again." });
    expect(await submitQuiz(LESSON, { texts: [] })).toMatchObject({ error: expect.stringMatching(/couldn't be read/) });
    expect(await repos().quizzes.attemptsOf(ADA, quiz.id)).toEqual([]);
  });

  it("says it couldn't save when storage can't be read", async () => {
    const { file } = await seed();
    storage.quizFileSize.mockRejectedValue(new Error("down"));
    const path = `${ADA}/11111111-1111-4111-8111-111111111111/letter.pdf`;
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(await submitQuiz(LESSON, { files: { [file]: { path, name: "letter.pdf", bytes: 1 } } })).toEqual({ error: "Couldn't save your answers. Try again." });
    spy.mockRestore();
  });
});
