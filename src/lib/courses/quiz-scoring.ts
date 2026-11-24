/**
 * Scoring a quiz attempt. Pure: no database, no clock. The server calls it with the questions as stored (correct
 * answers included) and what the member picked; the browser never receives `isCorrect` before submitting.
 *
 * The rules (docs/product/COURSES.md, "Quizzes"):
 * - A question is right only when the picked options are exactly the correct ones: all or nothing, with no partial
 *   credit, for a single-answer and a multiple-answer question alike. Picking nothing is wrong.
 * - So a single-answer question with more than one option picked is wrong (a tampered request).
 * - Option ids that don't belong to the question are ignored, and a repeated id counts once.
 * - A question is scored only when it is a choice question, marked graded, with a correct option marked. Any other
 *   (a short answer, a file upload, an ungraded choice question, a choice question with no right answer marked) is
 *   recorded, not scored: it is left out of the count, so it can never make a quiz impossible to pass.
 * - The percent is the share of scored questions answered right, rounded DOWN, so a score shown as 80 never
 *   fails an 80 percent grade. Passing is decided on exact integers, never on the rounded percent.
 * - A quiz with no passing grade is not graded: every attempt passes.
 * - A quiz with nothing to score (every question recorded only) has no score, and a passing grade cannot apply to
 *   it: every submitted attempt passes, which is what completes the lesson. A mixed quiz is passed on its scored
 *   questions alone; what members wrote or uploaded never decides a pass.
 */

export type QuestionKind = "choice" | "short_answer" | "file_upload";
export const QUESTION_KINDS: readonly QuestionKind[] = ["choice", "short_answer", "file_upload"];

export type ScoringOption = { id: string; isCorrect: boolean };
/** `kind` and `graded` default to a graded choice question, what every question was before the other kinds existed. */
export type ScoringQuestion = { id: string; kind?: QuestionKind; graded?: boolean; allowsMultiple: boolean; options: readonly ScoringOption[] };
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
  /** Whether the attempt counts as a pass (and so completes the lesson). Always true when nothing was scored. */
  passed: boolean;
  results: QuestionResult[];
};

/** Whether a question counts toward the score: a graded choice question with at least one correct option. */
export function isScorable(question: ScoringQuestion): boolean {
  return (question.kind ?? "choice") === "choice" && (question.graded ?? true) && question.options.some((o) => o.isCorrect);
}

/** Whether the question is answered with words or a file, not by picking options. */
export function isOpenQuestion(question: Pick<ScoringQuestion, "kind">): boolean {
  return (question.kind ?? "choice") !== "choice";
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

/** Scores an attempt. `passingPercent` null means the quiz is not graded; it is ignored when no question is scored. */
export function scoreQuiz(questions: readonly ScoringQuestion[], answers: QuizAnswers, passingPercent: number | null): QuizScore {
  const results = questions.map((q) => scoreQuestion(q, answers[q.id]));
  const scored = results.filter((r) => r.correct !== null);
  const correctCount = scored.filter((r) => r.correct).length;
  const questionCount = scored.length;
  const scorePercent = questionCount === 0 ? 0 : Math.floor((correctCount * 100) / questionCount);
  const passed = passingPercent === null || questionCount === 0 ? true : correctCount * 100 >= passingPercent * questionCount;
  return { questionCount, correctCount, scorePercent, passed, results };
}
