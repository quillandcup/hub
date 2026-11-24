/**
 * Scoring a quiz attempt. Pure: no database, no clock. The server calls it with the questions as stored (correct
 * answers included) and what the member picked; the browser never receives `isCorrect` before submitting.
 *
 * The rules (docs/product/COURSES.md, "Quizzes"):
 * - A question is right only when the picked options are exactly the correct ones: all or nothing, with no partial
 *   credit, for a single-answer and a multiple-answer question alike. Picking nothing is wrong.
 * - So a single-answer question with more than one option picked is wrong (a tampered request).
 * - Option ids that don't belong to the question are ignored, and a repeated id counts once.
 * - A question with no correct option marked is not scored (it can't be answered right): it is left out of the
 *   count, so it can never make a quiz impossible to pass.
 * - The percent is the share of scored questions answered right, rounded DOWN, so a score shown as 80 never
 *   fails an 80 percent grade. Passing is decided on exact integers, never on the rounded percent.
 * - A quiz with no passing grade is not graded: every attempt passes. A graded quiz with nothing to score never does.
 */

export type ScoringOption = { id: string; isCorrect: boolean };
export type ScoringQuestion = { id: string; allowsMultiple: boolean; options: readonly ScoringOption[] };
/** What a member picked: option ids by question id. A question with no entry was skipped. */
export type QuizAnswers = Readonly<Record<string, readonly string[] | undefined>>;

export type QuestionResult = {
  questionId: string;
  /** The picked options that belong to the question, once each, in the question's order. */
  selectedOptionIds: string[];
  /** Null when the question wasn't scored (no correct option marked). */
  correct: boolean | null;
};

export type QuizScore = {
  /** Scored questions. */
  questionCount: number;
  /** Scored questions answered right. */
  correctCount: number;
  /** Whole percent, rounded down, 0 to 100 (0 when nothing was scored). */
  scorePercent: number;
  /** Whether the attempt counts as a pass (and so completes the lesson). */
  passed: boolean;
  results: QuestionResult[];
};

/** Whether a question can be scored: at least one correct option. */
export function isScorable(question: ScoringQuestion): boolean {
  return question.options.some((o) => o.isCorrect);
}

/** The picked ids that are options of this question, once each, in the question's order. */
export function selectedOf(question: ScoringQuestion, picked: readonly string[] | undefined): string[] {
  const chosen = new Set(picked ?? []);
  return question.options.filter((o) => chosen.has(o.id)).map((o) => o.id);
}

export function scoreQuestion(question: ScoringQuestion, picked: readonly string[] | undefined): QuestionResult {
  const selected = selectedOf(question, picked);
  if (!isScorable(question)) return { questionId: question.id, selectedOptionIds: selected, correct: null };
  const correctIds = question.options.filter((o) => o.isCorrect).map((o) => o.id);
  // Exactly the correct options, no more and no fewer. That also makes a single-answer question (one correct option)
  // wrong when more than one is picked.
  const right = selected.length === correctIds.length && correctIds.every((id) => selected.includes(id));
  return { questionId: question.id, selectedOptionIds: selected, correct: right };
}

/** Scores an attempt. `passingPercent` null means the quiz is not graded. */
export function scoreQuiz(questions: readonly ScoringQuestion[], answers: QuizAnswers, passingPercent: number | null): QuizScore {
  const results = questions.map((q) => scoreQuestion(q, answers[q.id]));
  const scored = results.filter((r) => r.correct !== null);
  const correctCount = scored.filter((r) => r.correct).length;
  const questionCount = scored.length;
  const scorePercent = questionCount === 0 ? 0 : Math.floor((correctCount * 100) / questionCount);
  const passed = passingPercent === null ? true : questionCount > 0 && correctCount * 100 >= passingPercent * questionCount;
  return { questionCount, correctCount, scorePercent, passed, results };
}
