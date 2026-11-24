import { describe, expect, it } from "vitest";
import { asJson } from "@/lib/data/json";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { createInMemoryRepos } from "@/lib/data/repos";
import { syncCourseQuizzes } from "@/lib/courses/quiz-sync";
import { courseRow, lessonRow } from "../helpers/course-fixtures";

const COURSE_K = "course-1";
const LESSON_A = "les_AAAAAAAAAAA1";
const LESSON_B = "les_AAAAAAAAAAA2";
const LESSON_HUB = "les_AAAAAAAAAAA3";
const MEMBER = "mbr_AAAAAAAAAAA1";

const document = (questions: string[], passing?: number) => ({
  questions: questions.map((id) => ({ id, text: `Question ${id}`, answers: [{ id: `${id}a`, text: "No", correct: false }, { id: `${id}b`, text: "Yes", correct: true }] })),
  ...(passing ? { passing_grade: passing } : {}),
});
const bronzeQuiz = (id: string, lesson: string, documents: unknown[]) => ({ kajabi_id: id, course_kajabi_id: COURSE_K, lesson_kajabi_id: lesson, raw_payload: asJson({ documents }), content_hash: id, captured_at: "2027-01-01T00:00:00.000Z", deleted_at: null });

const build = (quizzes = [bronzeQuiz("100", "kl-a", [document(["q1", "q2"], 80)])]) => {
  const data = new InMemoryDataset({
    courses: [courseRow({ id: "crs_AAAAAAAAAAA1", slug: "c", title: "C", source: "kajabi", source_key: COURSE_K })],
    courseLessons: [
      lessonRow({ id: LESSON_A, course_id: "crs_AAAAAAAAAAA1", title: "Let's Check In", source: "kajabi", source_key: "kl-a" }),
      lessonRow({ id: LESSON_B, course_id: "crs_AAAAAAAAAAA1", title: "Plain", position: 2, source: "kajabi", source_key: "kl-b" }),
      lessonRow({ id: LESSON_HUB, course_id: "crs_AAAAAAAAAAA1", title: "Hub", position: 3, source: "hub", source_key: null }),
    ],
    kajabiQuizzes: quizzes,
  });
  const repos = createInMemoryRepos(data);
  const lessons = new Map([["kl-a", LESSON_A], ["kl-b", LESSON_B]]);
  return { data, repos, lessons };
};

describe("syncCourseQuizzes", () => {
  it("attaches a captured quiz to its lesson with its questions, answers and settings, and leaves the other lessons plain", async () => {
    const { repos, lessons } = build();

    const summary = await syncCourseQuizzes(repos, COURSE_K, lessons);

    expect(summary).toEqual({ synced: 1, questions: 2, removed: 0, unreadable: 0, noLesson: 0, skippedQuestions: 0, skippedManual: 0 });
    const quiz = (await repos.quizzes.quizOfLesson(LESSON_A))!;
    expect(quiz).toMatchObject({ passingPercent: 80, hideAnswers: false, sourceKey: "100" });
    expect((await repos.quizzes.questionsOf(quiz.id)).map((q) => [q.sourceKey, q.prompt, q.options.filter((o) => o.isCorrect).map((o) => o.label)])).toEqual([["q1", "Question q1", ["Yes"]], ["q2", "Question q2", ["Yes"]]]);
    expect(await repos.quizzes.quizOfLesson(LESSON_B)).toBeNull();
  });

  it("is idempotent: syncing again keeps every id and adds nothing", async () => {
    const { repos, lessons } = build();
    await syncCourseQuizzes(repos, COURSE_K, lessons);
    const quiz = (await repos.quizzes.quizOfLesson(LESSON_A))!;
    const before = await repos.quizzes.questionsOf(quiz.id);

    expect(await syncCourseQuizzes(repos, COURSE_K, lessons)).toMatchObject({ synced: 1, questions: 2, removed: 0 });

    expect((await repos.quizzes.quizOfLesson(LESSON_A))!.id).toBe(quiz.id);
    expect(await repos.quizzes.questionsOf(quiz.id)).toEqual(before);
  });

  it("follows a changed capture, keeping a member's attempt, and drops a question Kajabi dropped", async () => {
    const { data, repos, lessons } = build();
    await syncCourseQuizzes(repos, COURSE_K, lessons);
    const quiz = (await repos.quizzes.quizOfLesson(LESSON_A))!;
    const [first] = await repos.quizzes.questionsOf(quiz.id);
    const attempt = await repos.quizzes.recordAttempt({ quizId: quiz.id, memberId: MEMBER, questionCount: 2, correctCount: 1, scorePercent: 50, passed: false, answers: [] });
    data.kajabiQuizzes[0].raw_payload = asJson({ documents: [document(["q1"], 60)] });

    expect(await syncCourseQuizzes(repos, COURSE_K, lessons)).toMatchObject({ synced: 1, questions: 1 });

    expect((await repos.quizzes.quizOfLesson(LESSON_A))).toMatchObject({ id: quiz.id, passingPercent: 60 });
    expect((await repos.quizzes.questionsOf(quiz.id)).map((q) => q.id)).toEqual([first.id]);
    expect((await repos.quizzes.attemptsOf(MEMBER, quiz.id)).map((a) => a.id)).toEqual([attempt.id]);
  });

  it("removes the quiz when Bronze no longer has it live, but not one made in the Hub", async () => {
    const { data, repos, lessons } = build();
    await syncCourseQuizzes(repos, COURSE_K, lessons);
    const hubQuiz = await repos.quizzes.createQuiz(LESSON_HUB);
    data.kajabiQuizzes[0].deleted_at = "2027-02-01T00:00:00.000Z";

    expect(await syncCourseQuizzes(repos, COURSE_K, new Map([...lessons, ["hub-lesson", LESSON_HUB]]))).toMatchObject({ synced: 0, removed: 1 });

    expect(await repos.quizzes.quizOfLesson(LESSON_A)).toBeNull();
    expect((await repos.quizzes.quizOfLesson(LESSON_HUB))?.id).toBe(hubQuiz.id);
  });

  it("keeps what Silver has, and counts it, when the capture can't be read or its lesson isn't there", async () => {
    const { data, repos, lessons } = build([bronzeQuiz("100", "kl-a", [document(["q1"])]), bronzeQuiz("200", "kl-gone", [document(["q1"])])]);
    await syncCourseQuizzes(repos, COURSE_K, lessons);
    const quiz = (await repos.quizzes.quizOfLesson(LESSON_A))!;
    data.kajabiQuizzes[0].raw_payload = asJson({ documents: [{ nothing: "readable" }] });

    const summary = await syncCourseQuizzes(repos, COURSE_K, lessons);

    expect(summary).toEqual({ synced: 0, questions: 0, removed: 0, unreadable: 1, noLesson: 1, skippedQuestions: 0, skippedManual: 0 });
    expect((await repos.quizzes.quizOfLesson(LESSON_A))?.id).toBe(quiz.id);
    expect((await repos.quizzes.questionsOf(quiz.id)).length).toBe(1);
  });

  it("counts the questions it leaves out because they don't fit", async () => {
    const wide = { questions: [{ id: "w", text: "Too many", answers: Array.from({ length: 13 }, (_, i) => ({ id: i, text: `a${i}`, correct: i === 0 })) }, ...document(["ok"]).questions] };
    const { repos, lessons } = build([bronzeQuiz("100", "kl-a", [wide])]);

    expect(await syncCourseQuizzes(repos, COURSE_K, lessons)).toMatchObject({ synced: 1, questions: 1, skippedQuestions: 1 });
  });

  it("skips a quiz with a question graded by hand in Kajabi, keeping what Silver has, and says so", async () => {
    const { data, repos, lessons } = build();
    await syncCourseQuizzes(repos, COURSE_K, lessons);
    const quiz = (await repos.quizzes.quizOfLesson(LESSON_A))!;
    const manual = { questions: [...document(["q1"]).questions, { id: "s1", text: "Tell us more", question_type: "short_answer" }, { id: "f1", text: "Upload a page", type: "file_upload", graded_manually: true }] };
    data.kajabiQuizzes[0].raw_payload = asJson({ documents: [manual] });

    expect(await syncCourseQuizzes(repos, COURSE_K, lessons)).toEqual({ synced: 0, questions: 0, removed: 0, unreadable: 0, noLesson: 0, skippedQuestions: 0, skippedManual: 1 });

    expect((await repos.quizzes.questionsOf(quiz.id)).length).toBe(2);
  });

  it("does nothing for a course with no captured quiz, and skips a lesson that is the Hub's", async () => {
    const empty = build([]);
    expect(await syncCourseQuizzes(empty.repos, COURSE_K, empty.lessons)).toEqual({ synced: 0, questions: 0, removed: 0, unreadable: 0, noLesson: 0, skippedQuestions: 0, skippedManual: 0 });
    const { repos } = build([bronzeQuiz("300", "hub-lesson", [document(["q1"])])]);
    expect(await syncCourseQuizzes(repos, COURSE_K, new Map([["hub-lesson", LESSON_HUB]]))).toMatchObject({ synced: 0 });
    expect(await repos.quizzes.quizOfLesson(LESSON_HUB)).toBeNull();
  });
});
