import { describe, expect, it } from "vitest";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { createInMemoryRepos } from "@/lib/data/repos";
import { loadMemberQuiz, parseAnswers, submitQuizAttempt, type SubmittedAnswers, type VerifyAnswerFile } from "@/lib/courses/quiz-member";
import { newQuizFilePath } from "@/lib/courses/quiz-files";
import { QUIZ_ANSWERS } from "@/lib/config";
import { courseRow, lessonRow } from "../helpers/course-fixtures";

const COURSE = "crs_AAAAAAAAAAA1";
const LESSON = "les_AAAAAAAAAAA1";
const ADA = "mbr_AAAAAAAAAAA1";
const NOW = new Date("2027-02-03T15:00:00.000Z");
const RANDOM = "11111111-1111-4111-8111-111111111111";

let data: InMemoryDataset;
const build = () => createInMemoryRepos((data = new InMemoryDataset({ courses: [courseRow({ id: COURSE, slug: "c", title: "C" })], courseLessons: [lessonRow({ id: LESSON, course_id: COURSE, title: "Reflect" })] })));

const answers = (over: Partial<SubmittedAnswers> = {}): SubmittedAnswers => ({ picks: {}, texts: {}, files: {}, ...over });
const inStorage = (bytes = 2048): VerifyAnswerFile => async () => ({ bytes });
const submit = (repos: ReturnType<typeof build>, a: SubmittedAnswers, verifyFile: VerifyAnswerFile = inStorage()) => submitQuizAttempt(repos, { memberId: ADA, lessonId: LESSON, answers: a, verifyFile, now: NOW });

/** A reflection: a short answer, a file upload, and a multiple choice question with no right answer. */
async function reflection(repos: ReturnType<typeof build>, settings: { passingPercent?: number } = {}) {
  const quiz = await repos.quizzes.createQuiz(LESSON, settings);
  const text = await repos.quizzes.saveQuestion(quiz.id, null, { prompt: "What stood out?", kind: "short_answer", graded: false, allowsMultiple: false, options: [] });
  const file = await repos.quizzes.saveQuestion(quiz.id, null, { prompt: "Upload your letter", kind: "file_upload", graded: false, allowsMultiple: false, options: [] });
  const choice = await repos.quizzes.saveQuestion(quiz.id, null, { prompt: "How was it?", kind: "choice", graded: false, allowsMultiple: false, options: [{ label: "Easy", isCorrect: false }, { label: "Hard", isCorrect: false }] });
  const options = (await repos.quizzes.questionsOf(quiz.id)).find((q) => q.id === choice)!.options;
  return { quiz, text, file, choice, options };
}

describe("a quiz of questions that are not graded", () => {
  it("records what was typed, uploaded and picked, has no score, and completes the lesson", async () => {
    const repos = build();
    const { quiz, text, file, choice, options } = await reflection(repos, { passingPercent: 90 });
    const path = newQuizFilePath(ADA, "letter.pdf", RANDOM);

    const outcome = await submit(repos, answers({ picks: { [choice]: [options[1].id] }, texts: { [text]: "  A lot.  " }, files: { [file]: { path, name: "letter.pdf", bytes: 1 } } }));

    expect(outcome).toMatchObject({ ok: true, submission: { scored: false, questionCount: 0, passed: true, passingPercent: null, lessonComplete: true } });
    const [attempt] = await repos.quizzes.attemptsOf(ADA, quiz.id);
    expect(attempt).toMatchObject({ questionCount: 0, correctCount: 0, passed: true });
    const stored = await repos.quizzes.answersOf(attempt.id);
    const by = Object.fromEntries(stored.map((a) => [a.questionId, a]));
    expect(by[text]).toMatchObject({ answerText: "A lot.", file: null, isCorrect: null });
    // What storage says the size is wins over what the browser claimed.
    expect(by[file].file).toEqual({ path, name: "letter.pdf", bytes: 2048 });
    expect(by[choice]).toMatchObject({ selectedOptionIds: [options[1].id], isCorrect: null });
    expect(await repos.courseProgress.completedLessonIds(ADA, [LESSON])).toEqual(new Set([LESSON]));
  });

  it("gives a choice review for choice questions only, and nothing to review when nothing is a choice", async () => {
    const repos = build();
    const { choice, text, options } = await reflection(repos);
    const outcome = await submit(repos, answers({ picks: { [choice]: [options[0].id] }, texts: { [text]: "x" } }));
    expect(outcome.ok && outcome.submission.review?.map((r) => r.questionId)).toEqual([choice]);
  });

  it("refuses an empty submission: completing the lesson takes at least one answer", async () => {
    const repos = build();
    const { quiz, text } = await reflection(repos);
    expect(await submit(repos, answers())).toEqual({ ok: false, error: "Answer at least one question before you submit." });
    expect(await submit(repos, answers({ texts: { [text]: "   " } }))).toMatchObject({ ok: false });
    expect(await repos.quizzes.attemptsOf(ADA, quiz.id)).toEqual([]);
    expect(await repos.courseProgress.completedLessonIds(ADA, [LESSON])).toEqual(new Set());
  });

  it("accepts a submission that skips some questions, as long as one is answered", async () => {
    const repos = build();
    const { quiz, text, file } = await reflection(repos);
    expect(await submit(repos, answers({ texts: { [text]: "Just this." } }))).toMatchObject({ ok: true });
    const [attempt] = await repos.quizzes.attemptsOf(ADA, quiz.id);
    expect((await repos.quizzes.answersOf(attempt.id)).find((a) => a.questionId === file)).toMatchObject({ file: null, answerText: null });
  });

  it("refuses a file that is not the member's own, not in storage, or not an allowed kind, recording nothing", async () => {
    const repos = build();
    const { quiz, file } = await reflection(repos);
    const ref = (path: string, name = "letter.pdf") => answers({ files: { [file]: { path, name, bytes: 1 } } });
    const own = newQuizFilePath(ADA, "letter.pdf", RANDOM);
    const problem = { ok: false, error: "One of your files couldn't be found. Upload it again." };

    expect(await submit(repos, ref(newQuizFilePath("mbr_BBBBBBBBBBB2", "letter.pdf", RANDOM)))).toEqual(problem);
    expect(await submit(repos, ref("staging/../x"))).toEqual(problem);
    expect(await submit(repos, ref(own), async () => null)).toEqual(problem);
    expect(await submit(repos, ref(newQuizFilePath(ADA, "run.exe", RANDOM), "letter.pdf"))).toMatchObject({ ok: false, error: expect.stringMatching(/document or a picture/) });
    expect(await submit(repos, ref(own, "run.exe"))).toMatchObject({ ok: false });
    expect(await submit(repos, ref(own), inStorage(QUIZ_ANSWERS.maxFileBytes + 1))).toMatchObject({ ok: false, error: expect.stringMatching(/up to 10 MB/) });
    expect(await repos.quizzes.attemptsOf(ADA, quiz.id)).toEqual([]);
  });

  it("ignores text or a file sent for a question that doesn't take one", async () => {
    const repos = build();
    const { quiz, text, choice, options } = await reflection(repos);
    await submit(repos, answers({ picks: { [choice]: [options[0].id] }, texts: { [choice]: "sneaky", [text]: "ok" } }));
    const [attempt] = await repos.quizzes.attemptsOf(ADA, quiz.id);
    const stored = await repos.quizzes.answersOf(attempt.id);
    expect(stored.find((a) => a.questionId === choice)?.answerText).toBeNull();
  });
});

describe("a quiz that mixes graded and ungraded questions", () => {
  async function mixed(repos: ReturnType<typeof build>, passingPercent: number) {
    const quiz = await repos.quizzes.createQuiz(LESSON, { passingPercent });
    const graded = await repos.quizzes.saveQuestion(quiz.id, null, { prompt: "Two plus two?", allowsMultiple: false, options: [{ label: "4", isCorrect: true }, { label: "5", isCorrect: false }] });
    const text = await repos.quizzes.saveQuestion(quiz.id, null, { prompt: "Why?", kind: "short_answer", graded: false, allowsMultiple: false, options: [] });
    const options = (await repos.quizzes.questionsOf(quiz.id)).find((q) => q.id === graded)!.options;
    return { quiz, graded, text, right: options[0].id, wrong: options[1].id };
  }

  it("is passed on the graded question alone, whatever was written", async () => {
    const repos = build();
    const { graded, text, wrong, right } = await mixed(repos, 100);
    const miss = await submit(repos, answers({ picks: { [graded]: [wrong] }, texts: { [text]: "a long reflection" } }));
    expect(miss).toMatchObject({ ok: true, submission: { scored: true, questionCount: 1, correctCount: 0, passed: false, lessonComplete: false } });
    const hit = await submit(repos, answers({ picks: { [graded]: [right] } }));
    expect(hit).toMatchObject({ ok: true, submission: { scored: true, scorePercent: 100, passed: true, passingPercent: 100, lessonComplete: true } });
  });

  it("shows the member's own words for the last attempts, never someone else's", async () => {
    const repos = build();
    const { graded, text, right } = await mixed(repos, 50);
    await submit(repos, answers({ picks: { [graded]: [right] }, texts: { [text]: "My own words." } }));
    const mine = (await loadMemberQuiz(repos, LESSON, ADA))!;
    expect(mine.attempts[0].openAnswers).toEqual([{ questionId: text, prompt: "Why?", text: "My own words.", fileName: null }]);
    expect(mine.questions.map((q) => q.kind)).toEqual(["choice", "short_answer"]);
    expect((await loadMemberQuiz(repos, LESSON, "mbr_BBBBBBBBBBB2"))!.attempts).toEqual([]);
  });
});

describe("a passing grade on a quiz with nothing graded", () => {
  it("is not shown to members, whatever is stored", async () => {
    const repos = build();
    await reflection(repos, { passingPercent: 80 });
    expect((await loadMemberQuiz(repos, LESSON, ADA))!.passingPercent).toBeNull();
  });
});

describe("parseAnswers with words and files", () => {
  const ref = { path: newQuizFilePath(ADA, "a.pdf", RANDOM), name: "a.pdf", bytes: 10 };

  it("reads picks, texts and files", () => {
    expect(parseAnswers({ picks: { q: ["o"] }, texts: { s: "hi" }, files: { f: ref } })).toEqual({ picks: { q: ["o"] }, texts: { s: "hi" }, files: { f: ref } });
    expect(parseAnswers({ texts: { s: "hi" } })).toEqual({ picks: {}, texts: { s: "hi" }, files: {} });
  });

  it("refuses text that is too long and anything of the wrong shape", () => {
    expect(parseAnswers({ texts: { s: "x".repeat(QUIZ_ANSWERS.maxTextChars + 1) } })).toBeNull();
    expect(parseAnswers({ texts: { s: 5 } })).toBeNull();
    expect(parseAnswers({ texts: [] })).toBeNull();
    expect(parseAnswers({ files: { f: { path: 1, name: "a", bytes: 1 } } })).toBeNull();
    expect(parseAnswers({ files: { f: { path: "p", name: "a", bytes: "1" } } })).toBeNull();
    expect(parseAnswers({ files: { f: "x" } })).toBeNull();
    expect(parseAnswers({ picks: "x" })).toBeNull();
    expect(parseAnswers({ files: { f: { ...ref, path: "p".repeat(301) } } })).toBeNull();
  });
});
