import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { isOpenQuestion, isScorable, scoreQuestion, scoreQuiz, selectedOf, type ScoringQuestion } from "@/lib/courses/quiz-scoring";

const single: ScoringQuestion = {
  id: "q1",
  allowsMultiple: false,
  options: [
    { id: "a", isCorrect: false },
    { id: "b", isCorrect: true },
    { id: "c", isCorrect: false },
  ],
};
const multiple: ScoringQuestion = {
  id: "q2",
  allowsMultiple: true,
  options: [
    { id: "a", isCorrect: false },
    { id: "b", isCorrect: true },
    { id: "c", isCorrect: true },
    { id: "d", isCorrect: false },
  ],
};
const ungradable: ScoringQuestion = { id: "q3", allowsMultiple: false, options: [{ id: "x", isCorrect: false }, { id: "y", isCorrect: false }] };
const shortAnswer: ScoringQuestion = { id: "s1", kind: "short_answer", graded: false, allowsMultiple: false, options: [] };
const fileUpload: ScoringQuestion = { id: "f1", kind: "file_upload", graded: false, allowsMultiple: false, options: [] };
/** A choice question whose right answer is marked but that the author left ungraded (a reflection with options). */
const ungradedChoice: ScoringQuestion = { ...single, id: "g1", graded: false };

describe("scoreQuestion", () => {
  it("is right for the one correct answer of a single-answer question", () => {
    expect(scoreQuestion(single, ["b"])).toEqual({ questionId: "q1", selectedOptionIds: ["b"], correct: true });
  });

  it("is wrong for another option, for none, and for two", () => {
    expect(scoreQuestion(single, ["a"]).correct).toBe(false);
    expect(scoreQuestion(single, []).correct).toBe(false);
    expect(scoreQuestion(single, undefined).correct).toBe(false);
    expect(scoreQuestion(single, ["a", "b"]).correct).toBe(false);
  });

  it("gives a multiple-answer question no partial credit", () => {
    expect(scoreQuestion(multiple, ["b", "c"]).correct).toBe(true);
    expect(scoreQuestion(multiple, ["c", "b"]).correct).toBe(true);
    expect(scoreQuestion(multiple, ["b"]).correct).toBe(false);
    expect(scoreQuestion(multiple, ["b", "c", "d"]).correct).toBe(false);
    expect(scoreQuestion(multiple, ["a", "d"]).correct).toBe(false);
  });

  it("ignores options that are not the question's and counts a repeated id once", () => {
    expect(scoreQuestion(single, ["b", "b"])).toMatchObject({ selectedOptionIds: ["b"], correct: true });
    expect(scoreQuestion(single, ["b", "elsewhere"])).toMatchObject({ selectedOptionIds: ["b"], correct: true });
    expect(selectedOf(multiple, ["d", "zzz", "b", "b"])).toEqual(["b", "d"]);
  });

  it("does not score a question that has no correct option", () => {
    expect(isScorable(ungradable)).toBe(false);
    expect(scoreQuestion(ungradable, ["x"]).correct).toBeNull();
    expect(isScorable(single)).toBe(true);
  });
});

describe("scoreQuiz", () => {
  const questions = [single, multiple, { ...single, id: "q4" }];

  it("scores the share of questions answered right, rounded down", () => {
    const score = scoreQuiz(questions, { q1: ["b"], q2: ["b", "c"], q4: ["a"] }, null);
    expect(score).toMatchObject({ questionCount: 3, correctCount: 2, scorePercent: 66, passed: true });
    expect(score.results.map((r) => r.correct)).toEqual([true, true, false]);
  });

  it("passes every attempt of a quiz with no passing grade, even with nothing answered", () => {
    expect(scoreQuiz(questions, {}, null)).toMatchObject({ correctCount: 0, scorePercent: 0, passed: true });
  });

  it("passes at exactly the passing grade and fails just below it", () => {
    expect(scoreQuiz(questions, { q1: ["b"], q2: ["b", "c"] }, 66).passed).toBe(true);
    expect(scoreQuiz(questions, { q1: ["b"], q2: ["b", "c"] }, 67).passed).toBe(false);
    expect(scoreQuiz(questions, { q1: ["b"], q2: ["b", "c"], q4: ["b"] }, 100).passed).toBe(true);
    expect(scoreQuiz(questions, { q1: ["b"], q2: ["b"], q4: ["b"] }, 100).passed).toBe(false);
  });

  it("leaves an unscored question out of the count", () => {
    const score = scoreQuiz([single, ungradable], { q1: ["b"], q3: ["x"] }, 100);
    expect(score).toMatchObject({ questionCount: 1, correctCount: 1, scorePercent: 100, passed: true });
    expect(score.results[1]).toEqual({ questionId: "q3", selectedOptionIds: ["x"], correct: null });
  });

  it("passes a quiz that has nothing to score: no passing grade can apply to it", () => {
    expect(scoreQuiz([], {}, 50)).toMatchObject({ questionCount: 0, scorePercent: 0, passed: true });
    expect(scoreQuiz([ungradable], {}, 50).passed).toBe(true);
    expect(scoreQuiz([shortAnswer, fileUpload, ungradedChoice], {}, 100).passed).toBe(true);
    expect(scoreQuiz([], {}, null).passed).toBe(true);
  });
});

describe("questions that are not graded", () => {
  it("recognizes the kinds, treating a question without one as a graded choice question", () => {
    expect(isOpenQuestion(single)).toBe(false);
    expect(isOpenQuestion(shortAnswer)).toBe(true);
    expect(isOpenQuestion(fileUpload)).toBe(true);
    expect(isScorable(shortAnswer)).toBe(false);
    expect(isScorable(fileUpload)).toBe(false);
    expect(isScorable(ungradedChoice)).toBe(false);
    expect(isScorable({ ...single, kind: "choice", graded: true })).toBe(true);
  });

  it("records an ungraded choice question's picks without scoring them, even when an option is marked right", () => {
    expect(scoreQuestion(ungradedChoice, ["b"])).toEqual({ questionId: "g1", selectedOptionIds: ["b"], correct: null });
    expect(scoreQuestion(ungradedChoice, ["a"]).correct).toBeNull();
  });

  it("gives a quiz of only ungraded questions no score, and every attempt passes whatever the passing grade", () => {
    const quiz = [shortAnswer, ungradedChoice, fileUpload];
    expect(scoreQuiz(quiz, { g1: ["a"] }, 80)).toMatchObject({ questionCount: 0, correctCount: 0, scorePercent: 0, passed: true });
    expect(scoreQuiz(quiz, {}, null).results.map((r) => r.correct)).toEqual([null, null, null]);
  });

  it("scores a mixed quiz on its graded questions alone", () => {
    const quiz = [single, shortAnswer, multiple, fileUpload, ungradedChoice];
    const right = scoreQuiz(quiz, { q1: ["b"], q2: ["b", "c"], g1: ["c"] }, 100);
    expect(right).toMatchObject({ questionCount: 2, correctCount: 2, scorePercent: 100, passed: true });
    const half = scoreQuiz(quiz, { q1: ["b"], q2: ["a"] }, 100);
    expect(half).toMatchObject({ questionCount: 2, correctCount: 1, scorePercent: 50, passed: false });
    // What was written or uploaded is not an input to the score at all.
    expect(scoreQuiz(quiz, { q1: ["b"], q2: ["a"], s1: ["ignored"] }, 100).correctCount).toBe(1);
  });
});

// Property tests (.claude/rules/property-based-testing.md): rules that hold for any quiz and any answers.
const optionIds = ["o1", "o2", "o3", "o4", "o5"];
const questionArb = (id: string): fc.Arbitrary<ScoringQuestion> =>
  fc
    .tuple(fc.boolean(), fc.array(fc.boolean(), { minLength: 2, maxLength: 5 }))
    .map(([allowsMultiple, flags]) => ({ id, allowsMultiple, options: flags.map((isCorrect, i) => ({ id: `${id}-${optionIds[i]}`, isCorrect })) }));
/** Any kind of question: graded or ungraded choice, short answer or file upload. */
const anyQuestionArb = (id: string): fc.Arbitrary<ScoringQuestion> =>
  fc.oneof(
    questionArb(id),
    questionArb(id).map((q) => ({ ...q, graded: false })),
    fc.constantFrom<ScoringQuestion>({ id, kind: "short_answer", graded: false, allowsMultiple: false, options: [] }, { id, kind: "file_upload", graded: false, allowsMultiple: false, options: [] }),
  );
const anyQuizArb = fc.integer({ min: 0, max: 8 }).chain((n) => fc.tuple(...Array.from({ length: n }, (_, i) => anyQuestionArb(`q${i}`))) as fc.Arbitrary<ScoringQuestion[]>);
const quizArb = fc.integer({ min: 0, max: 8 }).chain((n) => fc.tuple(...Array.from({ length: n }, (_, i) => questionArb(`q${i}`))) as fc.Arbitrary<ScoringQuestion[]>);
const pickedArb = (questions: ScoringQuestion[]) =>
  fc.dictionary(
    fc.constantFrom(...(questions.length ? questions.map((q) => q.id) : ["none"])),
    fc.array(fc.oneof(fc.constantFrom(...questions.flatMap((q) => q.options.map((o) => o.id)), "unknown"), fc.string()), { maxLength: 6 }),
  );

describe("scoreQuiz (properties)", () => {
  it("keeps the counts and percent in range, and a pass agrees with the percent shown", () => {
    const attempt = quizArb.chain((questions) =>
      fc.tuple(fc.constant(questions), pickedArb(questions), fc.option(fc.integer({ min: 1, max: 100 }), { nil: null })),
    );
    fc.assert(
      fc.property(attempt, ([questions, answers, passing]) => {
        const score = scoreQuiz(questions, answers, passing);
        expect(score.correctCount).toBeGreaterThanOrEqual(0);
        expect(score.correctCount).toBeLessThanOrEqual(score.questionCount);
        expect(score.questionCount).toBe(questions.filter(isScorable).length);
        expect(score.scorePercent).toBeGreaterThanOrEqual(0);
        expect(score.scorePercent).toBeLessThanOrEqual(100);
        if (passing === null || score.questionCount === 0) expect(score.passed).toBe(true);
        // Rounding down means the percent shown never claims more than was earned, so a pass is never decided by
        // rounding up, and a score shown at the grade or above always passes.
        if (passing !== null && score.questionCount > 0 && score.passed) expect(score.scorePercent).toBeGreaterThanOrEqual(passing);
        if (passing !== null && score.questionCount > 0 && score.scorePercent >= passing) expect(score.passed).toBe(true);
      }),
      { numRuns: 400 },
    );
  });

  it("scores every correct selection as 100 percent and is unaffected by order or repeats", () => {
    fc.assert(
      fc.property(quizArb, fc.boolean(), (questions, reverse) => {
        const perfect = Object.fromEntries(
          questions.map((q) => {
            const ids = q.options.filter((o) => o.isCorrect).map((o) => o.id);
            return [q.id, reverse ? [...ids].reverse().concat(ids) : ids];
          }),
        );
        const score = scoreQuiz(questions, perfect, 100);
        expect(score.correctCount).toBe(score.questionCount);
        if (score.questionCount > 0) {
          expect(score.scorePercent).toBe(100);
          expect(score.passed).toBe(true);
        }
      }),
      { numRuns: 200 },
    );
  });

  it("is never right when an incorrect option is added to a right answer, or a correct one is left out", () => {
    fc.assert(
      fc.property(questionArb("q"), (question) => {
        const correct = question.options.filter((o) => o.isCorrect).map((o) => o.id);
        if (correct.length === 0) return;
        expect(scoreQuestion(question, correct).correct).toBe(true);
        const wrong = question.options.find((o) => !o.isCorrect);
        if (wrong) expect(scoreQuestion(question, [...correct, wrong.id]).correct).toBe(false);
        if (correct.length > 1) expect(scoreQuestion(question, correct.slice(1)).correct).toBe(false);
        expect(scoreQuestion(question, []).correct).toBe(false);
      }),
      { numRuns: 300 },
    );
  });

  it("scores only graded choice questions, and a quiz with none always passes", () => {
    fc.assert(
      fc.property(anyQuizArb, fc.dictionary(fc.string(), fc.array(fc.string(), { maxLength: 4 })), fc.integer({ min: 1, max: 100 }), (questions, answers, passing) => {
        const score = scoreQuiz(questions, answers, passing);
        const scored = questions.filter((q) => (q.kind ?? "choice") === "choice" && q.graded !== false && q.options.some((o) => o.isCorrect));
        expect(score.questionCount).toBe(scored.length);
        for (const r of score.results) {
          const q = questions.find((x) => x.id === r.questionId)!;
          if (!scored.includes(q)) expect(r.correct).toBeNull();
        }
        if (scored.length === 0) expect(score.passed).toBe(true);
        // Answers to the questions that are not scored never change the score.
        const onlyScored = Object.fromEntries(Object.entries(answers).filter(([id]) => scored.some((q) => q.id === id)));
        expect(scoreQuiz(questions, onlyScored, passing)).toMatchObject({ questionCount: score.questionCount, correctCount: score.correctCount, passed: score.passed });
      }),
      { numRuns: 300 },
    );
  });

  it("never throws on hostile answers", () => {
    fc.assert(
      fc.property(quizArb, fc.dictionary(fc.string(), fc.array(fc.string(), { maxLength: 4 })), (questions, answers) => {
        const score = scoreQuiz(questions, answers, 80);
        expect(score.results).toHaveLength(questions.length);
      }),
      { numRuns: 200 },
    );
  });
});
