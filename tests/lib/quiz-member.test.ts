import { describe, expect, it } from "vitest";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { createInMemoryRepos } from "@/lib/data/repos";
import { ATTEMPTS_SHOWN, loadMemberQuiz, parseAnswers, submitQuizAttempt } from "@/lib/courses/quiz-member";
import { courseRow, lessonRow } from "../helpers/course-fixtures";

const COURSE = "crs_AAAAAAAAAAA1";
const LESSON = "les_AAAAAAAAAAA1";
const PLAIN = "les_AAAAAAAAAAA2";
const ADA = "mbr_AAAAAAAAAAA1";
const GRACE = "mbr_AAAAAAAAAAA2";
const NOW = new Date("2027-02-03T15:00:00.000Z");

let data: InMemoryDataset;
const build = () => createInMemoryRepos((data = new InMemoryDataset({ courses: [courseRow({ id: COURSE, slug: "c", title: "C" })], courseLessons: [lessonRow({ id: LESSON, course_id: COURSE, title: "Let's check in" }), lessonRow({ id: PLAIN, course_id: COURSE, title: "Plain", position: 2 })] })));

/** A quiz of three questions: one answer (b), one answer (a), and two answers (a and c). Returns the ids by letter per question. */
async function seed(repos: ReturnType<typeof build>, settings: { passingPercent?: number; hideAnswers?: boolean } = {}) {
  const quiz = await repos.quizzes.createQuiz(LESSON, settings);
  const mk = async (prompt: string, allowsMultiple: boolean, right: string[]) => {
    const id = await repos.quizzes.saveQuestion(quiz.id, null, { prompt, allowsMultiple, options: ["a", "b", "c"].map((label) => ({ label, isCorrect: right.includes(label) })) });
    const options = (await repos.quizzes.questionsOf(quiz.id)).find((q) => q.id === id)!.options;
    return { id, opt: Object.fromEntries(options.map((o) => [o.label, o.id])) as Record<string, string> };
  };
  return { quiz, q1: await mk("One?", false, ["b"]), q2: await mk("Two?", false, ["a"]), q3: await mk("Three?", true, ["a", "c"]) };
}

const submit = (repos: ReturnType<typeof build>, answers: Record<string, string[]>, memberId = ADA, now = NOW) => submitQuizAttempt(repos, { memberId, lessonId: LESSON, answers, now });

describe("loadMemberQuiz", () => {
  it("is null for a lesson that isn't a quiz", async () => {
    expect(await loadMemberQuiz(build(), PLAIN, ADA)).toBeNull();
  });

  it("gives the questions and their answers, in order, and never which are right", async () => {
    const repos = build();
    await seed(repos, { passingPercent: 70, hideAnswers: true });

    const quiz = (await loadMemberQuiz(repos, LESSON, ADA))!;

    expect(quiz).toMatchObject({ passingPercent: 70, hideAnswers: true, passed: false, attempts: [] });
    expect(quiz.questions.map((q) => [q.prompt, q.allowsMultiple, q.options.map((o) => o.label)])).toEqual([
      ["One?", false, ["a", "b", "c"]],
      ["Two?", false, ["a", "b", "c"]],
      ["Three?", true, ["a", "b", "c"]],
    ]);
    // What goes to the browser carries no correct-answer field at all, however it is nested.
    for (const q of quiz.questions) {
      expect(Object.keys(q).sort()).toEqual(["allowsMultiple", "id", "options", "prompt"]);
      for (const o of q.options) expect(Object.keys(o).sort()).toEqual(["id", "label"]);
    }
    expect(JSON.stringify(quiz)).not.toMatch(/isCorrect|is_correct|correct/i);
  });

  it("lists the member's own attempts newest first, the last few, and whether they have passed", async () => {
    const repos = build();
    const { quiz } = await seed(repos, { passingPercent: 50 });
    const attempt = (memberId: string, day: number, passed: boolean) => repos.quizzes.recordAttempt({ quizId: quiz.id, memberId, questionCount: 3, correctCount: passed ? 3 : 0, scorePercent: passed ? 100 : 0, passed, submittedAt: `2027-01-0${day}T10:00:00.000Z`, answers: [] });
    for (let day = 1; day <= 7; day++) await attempt(ADA, day, day === 2);
    await attempt(GRACE, 8, true);

    const mine = (await loadMemberQuiz(repos, LESSON, ADA))!;

    expect(mine.attempts).toHaveLength(ATTEMPTS_SHOWN);
    expect(mine.attempts.map((a) => a.submittedAt.slice(0, 10))).toEqual(["2027-01-07", "2027-01-06", "2027-01-05", "2027-01-04", "2027-01-03"]);
    // The pass was on the 2nd, which is no longer in the list but still counts.
    expect(mine.passed).toBe(true);
    expect(Object.keys(mine.attempts[0]).sort()).toEqual(["correctCount", "id", "passed", "questionCount", "scorePercent", "submittedAt"]);
    expect((await loadMemberQuiz(repos, LESSON, "mbr_AAAAAAAAAAA9"))!.attempts).toEqual([]);
  });
});

describe("submitQuizAttempt", () => {
  it("completes the lesson on a pass, records the attempt and what was picked, and writes the activity once", async () => {
    const repos = build();
    const { quiz, q1, q2, q3 } = await seed(repos, { passingPercent: 100 });

    const outcome = await submit(repos, { [q1.id]: [q1.opt.b], [q2.id]: [q2.opt.a], [q3.id]: [q3.opt.c, q3.opt.a] });

    expect(outcome).toMatchObject({ ok: true, submission: { scorePercent: 100, correctCount: 3, questionCount: 3, passed: true, passingPercent: 100, lessonComplete: true } });
    const stored = await repos.quizzes.attemptsOf(ADA, quiz.id);
    expect(stored).toMatchObject([{ scorePercent: 100, passed: true, submittedAt: NOW.toISOString() }]);
    expect((await repos.quizzes.answersOf(stored[0].id)).map((a) => a.isCorrect)).toEqual([true, true, true]);
    expect(await repos.courseProgress.completedLessonIds(ADA, [LESSON])).toEqual(new Set([LESSON]));
    // One "Completed <lesson>" row for the member, written once however many passes follow.
    await submit(repos, { [q1.id]: [q1.opt.b], [q2.id]: [q2.opt.a], [q3.id]: [q3.opt.a, q3.opt.c] });
    const rows = (await repos.activities.engagementSince(ADA, "2027-01-01T00:00:00.000Z")).filter((r) => r.activity_type === "lesson_completed");
    expect(rows).toHaveLength(1);
  });

  it("scores all or nothing: a multiple-answer question with one of two right answers is wrong", async () => {
    const repos = build();
    const { q1, q2, q3 } = await seed(repos, { passingPercent: 100 });
    const outcome = await submit(repos, { [q1.id]: [q1.opt.b], [q2.id]: [q2.opt.a], [q3.id]: [q3.opt.a] });
    expect(outcome).toMatchObject({ ok: true, submission: { scorePercent: 66, correctCount: 2, passed: false, lessonComplete: false } });
  });

  it("does not complete the lesson on a fail, and a later pass completes it", async () => {
    const repos = build();
    const { q1, q2, q3 } = await seed(repos, { passingPercent: 100 });

    const failed = await submit(repos, {});
    expect(failed).toMatchObject({ ok: true, submission: { scorePercent: 0, passed: false, lessonComplete: false } });
    expect(await repos.courseProgress.completedLessonIds(ADA, [LESSON])).toEqual(new Set());

    const passed = await submit(repos, { [q1.id]: [q1.opt.b], [q2.id]: [q2.opt.a], [q3.id]: [q3.opt.a, q3.opt.c] });
    expect(passed).toMatchObject({ ok: true, submission: { passed: true, lessonComplete: true } });
    expect(await repos.courseProgress.completedLessonIds(ADA, [LESSON])).toEqual(new Set([LESSON]));
  });

  it("completes the lesson for any attempt at a quiz that has no passing grade", async () => {
    const repos = build();
    await seed(repos);
    const outcome = await submit(repos, {});
    expect(outcome).toMatchObject({ ok: true, submission: { scorePercent: 0, passed: true, passingPercent: null, lessonComplete: true } });
    expect(await repos.courseProgress.completedLessonIds(ADA, [LESSON])).toEqual(new Set([LESSON]));
  });

  it("keeps a lesson complete, with its first date, when a later attempt fails or passes again", async () => {
    const repos = build();
    const { q1, q2, q3 } = await seed(repos, { passingPercent: 100 });
    const all = { [q1.id]: [q1.opt.b], [q2.id]: [q2.opt.a], [q3.id]: [q3.opt.a, q3.opt.c] };
    await submit(repos, all, ADA, new Date("2027-02-03T15:00:00.000Z"));
    const first = (await repos.courseProgress.progressOfLessons([LESSON]))[0].completed_at;

    const failed = await submit(repos, {}, ADA, new Date("2027-02-04T15:00:00.000Z"));
    expect(failed).toMatchObject({ ok: true, submission: { passed: false, lessonComplete: true } });
    await submit(repos, all, ADA, new Date("2027-02-05T15:00:00.000Z"));

    expect((await repos.courseProgress.progressOfLessons([LESSON]))[0].completed_at).toBe(first);
  });

  it("keeps each member's attempts and completion apart", async () => {
    const repos = build();
    const { quiz, q1, q2, q3 } = await seed(repos, { passingPercent: 100 });
    await submit(repos, { [q1.id]: [q1.opt.b], [q2.id]: [q2.opt.a], [q3.id]: [q3.opt.a, q3.opt.c] }, ADA);
    await submit(repos, {}, GRACE);
    expect(await repos.courseProgress.completedLessonIds(GRACE, [LESSON])).toEqual(new Set());
    expect((await repos.quizzes.attemptsOf(GRACE, quiz.id)).map((a) => a.passed)).toEqual([false]);
  });

  it("shows which answers were right when the quiz shows them, and nothing when it hides them", async () => {
    const shown = build();
    const a = await seed(shown, { passingPercent: 100 });
    const outcome = await submit(shown, { [a.q1.id]: [a.q1.opt.a], [a.q2.id]: [a.q2.opt.a], [a.q3.id]: [a.q3.opt.a, a.q3.opt.c] });
    expect(outcome.ok && outcome.submission.review).toEqual([
      { questionId: a.q1.id, correct: false, selectedOptionIds: [a.q1.opt.a], correctOptionIds: [a.q1.opt.b] },
      { questionId: a.q2.id, correct: true, selectedOptionIds: [a.q2.opt.a], correctOptionIds: [a.q2.opt.a] },
      { questionId: a.q3.id, correct: true, selectedOptionIds: [a.q3.opt.a, a.q3.opt.c], correctOptionIds: [a.q3.opt.a, a.q3.opt.c] },
    ]);

    const hidden = build();
    const b = await seed(hidden, { passingPercent: 100, hideAnswers: true });
    const hiddenOutcome = await submit(hidden, { [b.q1.id]: [b.q1.opt.a] });
    expect(hiddenOutcome.ok && hiddenOutcome.submission.review).toBeNull();
    expect(JSON.stringify(hiddenOutcome)).not.toContain(b.q1.opt.b);
  });

  it("ignores option ids that aren't the question's, so a made-up pick scores as nothing", async () => {
    const repos = build();
    const { quiz, q1, q2 } = await seed(repos, { passingPercent: 1 });
    const outcome = await submit(repos, { [q1.id]: [q2.opt.b], [q2.id]: ["qopt_AAAAAAAAAAA9"], "qques_AAAAAAAAAAA9": [q1.opt.b] });
    expect(outcome).toMatchObject({ ok: true, submission: { correctCount: 0, passed: false } });
    const stored = await repos.quizzes.attemptsOf(ADA, quiz.id);
    expect((await repos.quizzes.answersOf(stored[0].id)).every((a) => a.selectedOptionIds.length === 0)).toBe(true);
  });

  it("leaves a question with no right answer marked out of the score", async () => {
    const repos = build();
    const quiz = await repos.quizzes.createQuiz(LESSON, { passingPercent: 100 });
    const id = await repos.quizzes.saveQuestion(quiz.id, null, { prompt: "Fine?", allowsMultiple: false, options: [{ label: "Yes", isCorrect: true }, { label: "No", isCorrect: false }] });
    const stored = (await repos.quizzes.questionsOf(quiz.id))[0];
    // An imported question can come without one (the builder never saves such a question).
    data.quizOptions.forEach((o) => (o.is_correct = false));
    const outcome = await submit(repos, { [id]: [stored.options[0].id] });
    expect(outcome).toMatchObject({ ok: true, submission: { questionCount: 0, passed: false } });
  });

  it("refuses a lesson that isn't a quiz and a quiz with no questions, recording nothing", async () => {
    const repos = build();
    expect(await submitQuizAttempt(repos, { memberId: ADA, lessonId: PLAIN, answers: {}, now: NOW })).toEqual({ ok: false, error: "This isn't a quiz." });
    expect(await submitQuizAttempt(repos, { memberId: ADA, lessonId: "les_AAAAAAAAAAA9", answers: {}, now: NOW })).toEqual({ ok: false, error: "This isn't a quiz." });
    const quiz = await repos.quizzes.createQuiz(LESSON);
    expect(await submit(repos, {})).toEqual({ ok: false, error: "This quiz has no questions yet." });
    expect(await repos.quizzes.attemptsOfQuiz(quiz.id)).toEqual([]);
  });
});

describe("parseAnswers", () => {
  it("reads option ids by question id", () => {
    expect(parseAnswers({ qques_a: ["qopt_a", "qopt_b"], qques_b: [] })).toEqual({ qques_a: ["qopt_a", "qopt_b"], qques_b: [] });
    expect(parseAnswers({})).toEqual({});
  });

  it("refuses anything else: not an object, picks that aren't lists of short strings, or too many", () => {
    for (const bad of [null, undefined, "x", 7, [], { q: "qopt_a" }, { q: [1] }, { q: [{}] }, { q: ["x".repeat(41)] }, { q: Array.from({ length: 51 }, () => "a") }, Object.fromEntries(Array.from({ length: 201 }, (_, i) => [`q${i}`, []]))]) {
      expect(parseAnswers(bad)).toBeNull();
    }
  });
});
