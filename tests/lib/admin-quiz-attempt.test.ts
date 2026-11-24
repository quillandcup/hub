import { describe, expect, it } from "vitest";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { createInMemoryRepos } from "@/lib/data/repos";
import { loadAdminQuiz, loadAttemptView } from "@/lib/courses/admin-quiz";
import { courseRow, lessonRow } from "../helpers/course-fixtures";

const COURSE = "crs_AAAAAAAAAAA1";
const LESSON = "les_AAAAAAAAAAA1";
const ADA = "mbr_AAAAAAAAAAA1";

const build = () =>
  createInMemoryRepos(
    new InMemoryDataset({
      courses: [courseRow({ id: COURSE, slug: "c", title: "Plot Lab", source: "hub", source_key: null })],
      courseLessons: [lessonRow({ id: LESSON, course_id: COURSE, title: "Reflect" })],
      members: [{ id: ADA, name: "Ada Example", email: "ada@example.test", displayName: "Ada E." }],
    }),
  );

async function reflection(repos: ReturnType<typeof build>) {
  const quiz = await repos.quizzes.createQuiz(LESSON, { passingPercent: 60 });
  const text = await repos.quizzes.saveQuestion(quiz.id, null, { prompt: "What stood out?", kind: "short_answer", graded: false, allowsMultiple: false, options: [] });
  const file = await repos.quizzes.saveQuestion(quiz.id, null, { prompt: "Upload", kind: "file_upload", graded: false, allowsMultiple: false, options: [] });
  const choice = await repos.quizzes.saveQuestion(quiz.id, null, { prompt: "How was it?", kind: "choice", graded: false, allowsMultiple: false, options: [{ label: "Easy", isCorrect: false }, { label: "Hard", isCorrect: false }] });
  const options = (await repos.quizzes.questionsOf(quiz.id)).find((q) => q.id === choice)!.options;
  return { quiz, text, file, choice, options };
}

describe("loadAdminQuiz for a quiz that is not graded", () => {
  it("says no question counts toward a score, and that there are questions members answer in words", async () => {
    const repos = build();
    await reflection(repos);
    expect(await loadAdminQuiz(repos, COURSE, LESSON)).toMatchObject({ hasGradedQuestions: false, hasOpenQuestions: true });
  });

  it("says a graded question counts, and that a quiz of choices has nothing to open", async () => {
    const repos = build();
    const quiz = await repos.quizzes.createQuiz(LESSON);
    await repos.quizzes.saveQuestion(quiz.id, null, { prompt: "One?", allowsMultiple: false, options: [{ label: "Yes", isCorrect: true }, { label: "No", isCorrect: false }] });
    expect(await loadAdminQuiz(repos, COURSE, LESSON)).toMatchObject({ hasGradedQuestions: true, hasOpenQuestions: false });
  });
});

describe("loadAttemptView", () => {
  it("shows every answer of an attempt with the member's name: what they picked, wrote and uploaded", async () => {
    const repos = build();
    const { quiz, text, file, choice, options } = await reflection(repos);
    const attempt = await repos.quizzes.recordAttempt({
      quizId: quiz.id,
      memberId: ADA,
      questionCount: 0,
      correctCount: 0,
      scorePercent: 0,
      passed: true,
      submittedAt: "2027-01-05T15:30:00.000Z",
      answers: [
        { questionId: text, selectedOptionIds: [], isCorrect: null, answerText: "The ending." },
        { questionId: file, selectedOptionIds: [], isCorrect: null, file: { path: `${ADA}/x/letter.pdf`, name: "letter.pdf", bytes: 2048 } },
        { questionId: choice, selectedOptionIds: [options[1].id], isCorrect: null },
      ],
    });

    const view = (await loadAttemptView(repos, quiz.id, attempt.id))!;

    expect(view.result).toMatchObject({ name: "Ada E.", memberId: ADA, questionCount: 0, passed: true });
    expect(view.answers.map((a) => [a.prompt, a.kind, a.picked, a.text, a.file, a.correct])).toEqual([
      ["What stood out?", "short_answer", [], "The ending.", null, null],
      ["Upload", "file_upload", [], null, { name: "letter.pdf", bytes: 2048 }, null],
      ["How was it?", "choice", ["Hard"], null, null, null],
    ]);
    // The path in storage stays on the server: only the name and size reach the page.
    expect(JSON.stringify(view)).not.toContain(`${ADA}/x`);
  });

  it("lists a question with no answer as unanswered, and is null for another quiz's attempt or none", async () => {
    const repos = build();
    const { quiz, text } = await reflection(repos);
    const attempt = await repos.quizzes.recordAttempt({ quizId: quiz.id, memberId: ADA, questionCount: 0, correctCount: 0, scorePercent: 0, passed: true, answers: [{ questionId: text, selectedOptionIds: [], isCorrect: null, answerText: "x" }] });
    const view = (await loadAttemptView(repos, quiz.id, attempt.id))!;
    expect(view.answers).toHaveLength(3);
    expect(view.answers[1]).toMatchObject({ text: null, file: null, picked: [] });
    expect(await loadAttemptView(repos, "quiz_other", attempt.id)).toBeNull();
    expect(await loadAttemptView(repos, quiz.id, "qatt_AAAAAAAAAAA9")).toBeNull();
  });
});
