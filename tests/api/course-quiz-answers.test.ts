import { beforeEach, describe, expect, it, vi } from "vitest";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { createInMemoryRepos } from "@/lib/data/repos";
import { courseRow, lessonRow } from "../helpers/course-fixtures";

const caller = vi.hoisted(() => ({ value: null as null | { identity: { memberId: string } } }));
vi.mock("@/lib/courses/caller", () => ({ getCoursesCaller: async () => caller.value }));
const staff = vi.hoisted(() => vi.fn());
vi.mock("@/lib/admin-auth", () => ({ requireActionPermission: (...a: unknown[]) => staff(...a) }));
vi.mock("@/lib/supabase/service", () => ({ createServiceRoleClient: () => ({ marker: "service" }) }));
let dataset: InMemoryDataset;
vi.mock("@/lib/data/repos", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/data/repos")>()), createRepos: () => createInMemoryRepos(dataset) }));
const storage = vi.hoisted(() => ({ signedQuizFileDownload: vi.fn() }));
vi.mock("@/lib/courses/quiz-files-storage", () => storage);

const { GET } = await import("@/app/api/course-quiz-answers/[attemptId]/[questionId]/route");

const COURSE = "crs_AAAAAAAAAAA1";
const LESSON = "les_AAAAAAAAAAA1";
const ADA = "mbr_AAAAAAAAAAA1";
const GRACE = "mbr_AAAAAAAAAAA2";
const repos = () => createInMemoryRepos(dataset);
const call = (attemptId: string, questionId: string) => GET(new Request("http://localhost/x"), { params: Promise.resolve({ attemptId, questionId }) });

let attemptId = "";
let fileQuestion = "";
let textQuestion = "";

beforeEach(async () => {
  storage.signedQuizFileDownload.mockReset().mockResolvedValue("https://example.test/signed");
  staff.mockReset().mockResolvedValue({ ok: false, error: "Not authorized" });
  caller.value = { identity: { memberId: ADA } };
  dataset = new InMemoryDataset({ courses: [courseRow({ id: COURSE, slug: "c", title: "C" })], courseLessons: [lessonRow({ id: LESSON, course_id: COURSE, title: "Reflect" })] });
  const quiz = await repos().quizzes.createQuiz(LESSON);
  fileQuestion = await repos().quizzes.saveQuestion(quiz.id, null, { prompt: "Upload", kind: "file_upload", graded: false, allowsMultiple: false, options: [] });
  textQuestion = await repos().quizzes.saveQuestion(quiz.id, null, { prompt: "Write", kind: "short_answer", graded: false, allowsMultiple: false, options: [] });
  const attempt = await repos().quizzes.recordAttempt({
    quizId: quiz.id,
    memberId: ADA,
    questionCount: 0,
    correctCount: 0,
    scorePercent: 0,
    passed: true,
    answers: [
      { questionId: fileQuestion, selectedOptionIds: [], isCorrect: null, file: { path: `${ADA}/11111111-1111-4111-8111-111111111111/letter.pdf`, name: "letter.pdf", bytes: 10 } },
      { questionId: textQuestion, selectedOptionIds: [], isCorrect: null, answerText: "words" },
    ],
  });
  attemptId = attempt.id;
});

describe("GET /api/course-quiz-answers/[attemptId]/[questionId]", () => {
  it("sends the member who made the attempt to a short-lived link that saves the file under its name, never cached", async () => {
    const response = await call(attemptId, fileQuestion);
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("https://example.test/signed");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(storage.signedQuizFileDownload).toHaveBeenCalledWith({ marker: "service" }, `${ADA}/11111111-1111-4111-8111-111111111111/letter.pdf`, "letter.pdf");
  });

  it("sends staff who manage courses, whoever the member is", async () => {
    caller.value = { identity: { memberId: GRACE } };
    staff.mockResolvedValue({ ok: true });
    expect((await call(attemptId, fileQuestion)).status).toBe(302);
    expect(staff).toHaveBeenCalledWith("courses.manage");
  });

  it("is a plain 404 for another member, a signed-out visitor and staff without the permission, revealing nothing", async () => {
    caller.value = { identity: { memberId: GRACE } };
    expect((await call(attemptId, fileQuestion)).status).toBe(404);
    caller.value = null;
    expect((await call(attemptId, fileQuestion)).status).toBe(404);
    expect(storage.signedQuizFileDownload).not.toHaveBeenCalled();
  });

  it("is a 404 for an attempt that isn't there, a question with no file, and ids of the wrong shape", async () => {
    expect((await call("qatt_AAAAAAAAAAAa", fileQuestion)).status).toBe(404);
    expect((await call(attemptId, textQuestion)).status).toBe(404);
    expect((await call(attemptId, "qques_AAAAAAAAAAAa")).status).toBe(404);
    expect((await call("nope", fileQuestion)).status).toBe(404);
    expect((await call(attemptId, "nope")).status).toBe(404);
  });

  it("serves a file kept by its place (pos_<n>) for an imported answer no question matched, to the same people and no one else", async () => {
    const quiz = (await repos().quizzes.quizOfLesson(LESSON))!;
    const imported = await repos().quizzes.importAttempt({
      quizId: quiz.id,
      memberId: ADA,
      sourceKey: "s-1",
      submittedAt: null,
      answers: [],
      unlinked: [{ position: 4, prompt: "Old wording", kind: "file_upload", text: null, labels: [], file: { path: `${ADA}/11111111-1111-4111-8111-111111111111/old.pdf`, name: "old.pdf", bytes: 5 } }],
    });
    expect(imported).toBe("inserted");
    const attempts = await repos().quizzes.attemptsOf(ADA, quiz.id);
    const id = attempts.find((a) => a.importedFrom === "kajabi")!.id;
    const ok = await call(id, "pos_4");
    expect(ok.status).toBe(302);
    expect(storage.signedQuizFileDownload).toHaveBeenCalledWith({ marker: "service" }, `${ADA}/11111111-1111-4111-8111-111111111111/old.pdf`, "old.pdf");
    expect((await call(id, "pos_5")).status).toBe(404);
    caller.value = { identity: { memberId: GRACE } };
    expect((await call(id, "pos_4")).status).toBe(404);
  });

  it("says so when storage can't make the link", async () => {
    storage.signedQuizFileDownload.mockResolvedValue(null);
    expect((await call(attemptId, fileQuestion)).status).toBe(502);
  });
});
