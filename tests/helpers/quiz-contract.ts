import { describe, it, expect, beforeEach } from "vitest";
import type { QuizQuestionInput, QuizRepository } from "@/lib/data/quizzes";

export type QuizContractContext = {
  repo: () => QuizRepository;
  /** Two Hub-owned lessons that exist and are not quizzes yet. */
  lessons: [string, string];
  /** Two members that exist. */
  members: [string, string];
  /** Removes the quizzes (with their questions and attempts) this context made. */
  clear: () => Promise<void>;
};

const pick = (): QuizQuestionInput => ({
  prompt: "How are you feeling?",
  allowsMultiple: false,
  options: [
    { label: "Great", isCorrect: false },
    { label: "Fine", isCorrect: true },
    { label: "Tired", isCorrect: false },
  ],
});
const many = (): QuizQuestionInput => ({
  prompt: "Which are writing days?",
  allowsMultiple: true,
  options: [
    { label: "Monday", isCorrect: true },
    { label: "Tuesday", isCorrect: false },
    { label: "Wednesday", isCorrect: true },
  ],
});

/** Behavior every `QuizRepository` must have; run against the in-memory twin (unit) and Supabase (db). */
export function defineQuizContract(name: string, setup: () => QuizContractContext) {
  describe(`${name} (QuizRepository contract)`, () => {
    let ctx: QuizContractContext;
    beforeEach(async () => {
      ctx = setup();
      await ctx.clear();
    });

    it("makes a lesson a quiz lesson, with a passing grade and hidden answers as chosen", async () => {
      const [lesson, other] = ctx.lessons;
      expect(await ctx.repo().quizOfLesson(lesson)).toBeNull();

      const quiz = await ctx.repo().createQuiz(lesson, { passingPercent: 70, hideAnswers: true });

      expect(quiz).toMatchObject({ lessonId: lesson, passingPercent: 70, hideAnswers: true, revision: 0, sourceKey: null });
      expect(await ctx.repo().quizOfLesson(lesson)).toEqual(quiz);
      expect(await ctx.repo().quizOfLesson(other)).toBeNull();
      const map = await ctx.repo().quizzesOfLessons([lesson, other]);
      expect([...map.keys()]).toEqual([lesson]);
    });

    it("defaults to a quiz that is not graded and shows the answers", async () => {
      const quiz = await ctx.repo().createQuiz(ctx.lessons[0]);
      expect(quiz).toMatchObject({ passingPercent: null, hideAnswers: false });
    });

    it("refuses a second quiz on a lesson", async () => {
      await ctx.repo().createQuiz(ctx.lessons[0]);
      await expect(ctx.repo().createQuiz(ctx.lessons[0])).rejects.toMatchObject({ name: "QuizWriteError" });
    });

    it("changes the settings, and refuses a passing grade outside 1 to 100", async () => {
      const quiz = await ctx.repo().createQuiz(ctx.lessons[0], { passingPercent: 80 });
      await ctx.repo().updateSettings(quiz.id, { passingPercent: null, hideAnswers: true });
      expect(await ctx.repo().quizOfLesson(ctx.lessons[0])).toMatchObject({ passingPercent: null, hideAnswers: true });
      await expect(ctx.repo().updateSettings(quiz.id, { passingPercent: 101, hideAnswers: false })).rejects.toMatchObject({ name: "QuizWriteError" });
      await expect(ctx.repo().updateSettings(quiz.id, { passingPercent: 0, hideAnswers: false })).rejects.toMatchObject({ name: "QuizWriteError" });
      await expect(ctx.repo().updateSettings("quiz_NoSuchQuiz001", { passingPercent: null, hideAnswers: false })).rejects.toMatchObject({ code: "not_found" });
    });

    it("saves questions in order with their options and which are correct", async () => {
      const quiz = await ctx.repo().createQuiz(ctx.lessons[0]);
      const first = await ctx.repo().saveQuestion(quiz.id, null, pick());
      const second = await ctx.repo().saveQuestion(quiz.id, null, many());

      const questions = await ctx.repo().questionsOf(quiz.id);

      expect(questions.map((q) => [q.id, q.position, q.prompt, q.allowsMultiple])).toEqual([
        [first, 1, "How are you feeling?", false],
        [second, 2, "Which are writing days?", true],
      ]);
      expect(questions[0].options.map((o) => [o.position, o.label, o.isCorrect])).toEqual([
        [1, "Great", false],
        [2, "Fine", true],
        [3, "Tired", false],
      ]);
      expect(questions[1].options.filter((o) => o.isCorrect).map((o) => o.label)).toEqual(["Monday", "Wednesday"]);
      expect((await ctx.repo().quizOfLesson(ctx.lessons[0]))?.revision).toBe(2);
    });

    it("refuses a question that is not whole, and saves nothing", async () => {
      const quiz = await ctx.repo().createQuiz(ctx.lessons[0]);
      const bad: QuizQuestionInput[] = [
        { ...pick(), options: pick().options.map((o) => ({ ...o, isCorrect: false })) },
        { ...pick(), options: pick().options.map((o) => ({ ...o, isCorrect: true })) },
        { ...pick(), options: [{ label: "Only", isCorrect: true }] },
        { ...pick(), prompt: "   " },
        { ...pick(), options: [{ label: " ", isCorrect: true }, { label: "B", isCorrect: false }] },
        { ...pick(), options: Array.from({ length: 13 }, (_, i) => ({ label: `o${i}`, isCorrect: i === 0 })) },
        { ...many(), options: many().options.map((o) => ({ ...o, isCorrect: false })) },
      ];
      for (const input of bad) {
        await expect(ctx.repo().saveQuestion(quiz.id, null, input)).rejects.toMatchObject({ code: "invalid_question" });
      }
      await expect(ctx.repo().saveQuestion("quiz_NoSuchQuiz001", null, pick())).rejects.toMatchObject({ code: "not_found" });
      expect(await ctx.repo().questionsOf(quiz.id)).toEqual([]);
    });

    it("edits a question: keeps the ids of the options that stay, removes the ones left out, adds new ones", async () => {
      const quiz = await ctx.repo().createQuiz(ctx.lessons[0]);
      const id = await ctx.repo().saveQuestion(quiz.id, null, pick());
      const before = (await ctx.repo().questionsOf(quiz.id))[0];
      const fine = before.options.find((o) => o.label === "Fine")!;

      await ctx.repo().saveQuestion(quiz.id, id, {
        prompt: "How are you today?",
        allowsMultiple: false,
        options: [{ id: fine.id, label: "Fine, thanks", isCorrect: true }, { label: "Wonderful", isCorrect: false }],
      });

      const after = (await ctx.repo().questionsOf(quiz.id))[0];
      expect(after.id).toBe(id);
      expect(after.prompt).toBe("How are you today?");
      expect(after.options.map((o) => [o.label, o.isCorrect])).toEqual([["Fine, thanks", true], ["Wonderful", false]]);
      expect(after.options[0].id).toBe(fine.id);
      expect(after.options[1].id).not.toBe(fine.id);
    });

    it("refuses an edit that names another question's option or another quiz's question", async () => {
      const [a, b] = ctx.lessons;
      const quizA = await ctx.repo().createQuiz(a);
      const quizB = await ctx.repo().createQuiz(b);
      const qa = await ctx.repo().saveQuestion(quizA.id, null, pick());
      const qb = await ctx.repo().saveQuestion(quizB.id, null, many());
      const foreignOption = (await ctx.repo().questionsOf(quizB.id))[0].options[0];

      await expect(ctx.repo().saveQuestion(quizA.id, qa, { ...pick(), options: [{ id: foreignOption.id, label: "x", isCorrect: true }, { label: "y", isCorrect: false }] })).rejects.toMatchObject({ code: "invalid_question" });
      await expect(ctx.repo().saveQuestion(quizA.id, qb, pick())).rejects.toMatchObject({ code: "not_found" });
      // Nothing of either changed.
      expect((await ctx.repo().questionsOf(quizA.id))[0].options.map((o) => o.label)).toEqual(["Great", "Fine", "Tired"]);
      expect((await ctx.repo().questionsOf(quizB.id))[0].options).toHaveLength(3);
    });

    it("reorders the questions, refuses a stale list, and writes nothing for the order they already have", async () => {
      const quiz = await ctx.repo().createQuiz(ctx.lessons[0]);
      const first = await ctx.repo().saveQuestion(quiz.id, null, pick());
      const second = await ctx.repo().saveQuestion(quiz.id, null, many());
      const revision = async () => (await ctx.repo().quizOfLesson(ctx.lessons[0]))!.revision;

      await ctx.repo().reorderQuestions(quiz.id, [second, first]);
      expect((await ctx.repo().questionsOf(quiz.id)).map((q) => q.id)).toEqual([second, first]);
      const afterMove = await revision();

      await ctx.repo().reorderQuestions(quiz.id, [second, first]);
      expect(await revision()).toBe(afterMove);

      await expect(ctx.repo().reorderQuestions(quiz.id, [first])).rejects.toMatchObject({ code: "stale_order" });
      await expect(ctx.repo().reorderQuestions(quiz.id, [first, first])).rejects.toMatchObject({ code: "stale_order" });
      await expect(ctx.repo().reorderQuestions(quiz.id, [first, second, "qques_NoSuchOne001"])).rejects.toMatchObject({ code: "stale_order" });
      expect((await ctx.repo().questionsOf(quiz.id)).map((q) => q.id)).toEqual([second, first]);
    });

    it("deletes a question and closes the gap in the order", async () => {
      const quiz = await ctx.repo().createQuiz(ctx.lessons[0]);
      const first = await ctx.repo().saveQuestion(quiz.id, null, pick());
      const second = await ctx.repo().saveQuestion(quiz.id, null, many());

      await ctx.repo().deleteQuestion(quiz.id, first);

      expect((await ctx.repo().questionsOf(quiz.id)).map((q) => [q.id, q.position])).toEqual([[second, 1]]);
      await expect(ctx.repo().deleteQuestion(quiz.id, first)).rejects.toMatchObject({ code: "not_found" });
    });

    it("records an attempt with what was picked, and lists a member's attempts newest first", async () => {
      const [lesson] = ctx.lessons;
      const [ada, grace] = ctx.members;
      const quiz = await ctx.repo().createQuiz(lesson, { passingPercent: 50 });
      const q1 = await ctx.repo().saveQuestion(quiz.id, null, pick());
      const q2 = await ctx.repo().saveQuestion(quiz.id, null, many());
      const options = (await ctx.repo().questionsOf(quiz.id)).flatMap((q) => q.options);

      const failed = await ctx.repo().recordAttempt({
        quizId: quiz.id,
        memberId: ada,
        questionCount: 2,
        correctCount: 0,
        scorePercent: 0,
        passed: false,
        submittedAt: "2027-01-01T10:00:00.000Z",
        answers: [{ questionId: q1, selectedOptionIds: [options[0].id], isCorrect: false }, { questionId: q2, selectedOptionIds: [], isCorrect: false }],
      });
      const passed = await ctx.repo().recordAttempt({
        quizId: quiz.id,
        memberId: ada,
        questionCount: 2,
        correctCount: 2,
        scorePercent: 100,
        passed: true,
        submittedAt: "2027-01-02T10:00:00.000Z",
        answers: [{ questionId: q1, selectedOptionIds: [options[1].id], isCorrect: true }, { questionId: q2, selectedOptionIds: [options[3].id, options[5].id], isCorrect: true }],
      });
      await ctx.repo().recordAttempt({ quizId: quiz.id, memberId: grace, questionCount: 2, correctCount: 1, scorePercent: 50, passed: true, submittedAt: "2027-01-03T10:00:00.000Z", answers: [] });

      expect((await ctx.repo().attemptsOf(ada, quiz.id)).map((a) => [a.id, a.scorePercent, a.passed])).toEqual([
        [passed.id, 100, true],
        [failed.id, 0, false],
      ]);
      expect((await ctx.repo().attemptsOfQuiz(quiz.id)).map((a) => a.memberId)).toEqual([grace, ada, ada]);
      const answers = await ctx.repo().answersOf(passed.id);
      expect(answers.map((a) => [a.questionId, [...a.selectedOptionIds].sort(), a.isCorrect]).sort()).toEqual(
        [[q1, [options[1].id], true], [q2, [options[3].id, options[5].id].sort(), true]].sort(),
      );
      expect((await ctx.repo().answersOf(failed.id)).find((a) => a.questionId === q2)?.selectedOptionIds).toEqual([]);
      expect(await ctx.repo().hasPassed(ada, quiz.id)).toBe(true);
    });

    it("says a member has not passed until a passing attempt is recorded", async () => {
      const quiz = await ctx.repo().createQuiz(ctx.lessons[0], { passingPercent: 100 });
      expect(await ctx.repo().hasPassed(ctx.members[0], quiz.id)).toBe(false);
      await ctx.repo().recordAttempt({ quizId: quiz.id, memberId: ctx.members[0], questionCount: 1, correctCount: 0, scorePercent: 0, passed: false, answers: [] });
      expect(await ctx.repo().hasPassed(ctx.members[0], quiz.id)).toBe(false);
      expect(await ctx.repo().hasPassed(ctx.members[1], quiz.id)).toBe(false);
    });

    it("counts the attempts made at each lesson's quiz, leaving out a lesson with none or no quiz", async () => {
      const [a, b] = ctx.lessons;
      const quizA = await ctx.repo().createQuiz(a);
      await ctx.repo().createQuiz(b);
      const attempt = (memberId: string) => ({ quizId: quizA.id, memberId, questionCount: 1, correctCount: 0, scorePercent: 0, passed: false, answers: [] });
      await ctx.repo().recordAttempt(attempt(ctx.members[0]));
      await ctx.repo().recordAttempt(attempt(ctx.members[0]));
      await ctx.repo().recordAttempt(attempt(ctx.members[1]));

      expect([...(await ctx.repo().attemptCountsOfLessons([a, b, "les_NoSuchLesson1"])).entries()]).toEqual([[a, 3]]);
      expect((await ctx.repo().attemptCountsOfLessons([])).size).toBe(0);
    });

    it("keeps an attempt, with its score, when a question is deleted, and drops only the answers to it", async () => {
      const quiz = await ctx.repo().createQuiz(ctx.lessons[0]);
      const q1 = await ctx.repo().saveQuestion(quiz.id, null, pick());
      const q2 = await ctx.repo().saveQuestion(quiz.id, null, many());
      const attempt = await ctx.repo().recordAttempt({
        quizId: quiz.id,
        memberId: ctx.members[0],
        questionCount: 2,
        correctCount: 1,
        scorePercent: 50,
        passed: true,
        answers: [{ questionId: q1, selectedOptionIds: [], isCorrect: false }, { questionId: q2, selectedOptionIds: [], isCorrect: true }],
      });

      await ctx.repo().deleteQuestion(quiz.id, q1);

      expect((await ctx.repo().attemptsOf(ctx.members[0], quiz.id)).map((a) => [a.id, a.scorePercent])).toEqual([[attempt.id, 50]]);
      expect((await ctx.repo().answersOf(attempt.id)).map((a) => a.questionId)).toEqual([q2]);
    });

    it("takes a quiz off a lesson with its questions and every attempt", async () => {
      const quiz = await ctx.repo().createQuiz(ctx.lessons[0]);
      const q = await ctx.repo().saveQuestion(quiz.id, null, pick());
      await ctx.repo().recordAttempt({ quizId: quiz.id, memberId: ctx.members[0], questionCount: 1, correctCount: 1, scorePercent: 100, passed: true, answers: [{ questionId: q, selectedOptionIds: [], isCorrect: true }] });

      await ctx.repo().deleteQuiz(quiz.id);

      expect(await ctx.repo().quizOfLesson(ctx.lessons[0])).toBeNull();
      expect(await ctx.repo().questionsOf(quiz.id)).toEqual([]);
      expect(await ctx.repo().attemptsOfQuiz(quiz.id)).toEqual([]);
      await expect(ctx.repo().deleteQuiz(quiz.id)).rejects.toMatchObject({ code: "not_found" });
      // The lesson can become a quiz again, empty.
      expect((await ctx.repo().createQuiz(ctx.lessons[0])).revision).toBe(0);
    });
  });
}
