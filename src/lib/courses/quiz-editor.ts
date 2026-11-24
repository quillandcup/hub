import type { QuizQuestionInput } from "@/lib/data/quizzes";
import type { QuestionKind } from "@/lib/courses/quiz-scoring";

/**
 * What the quiz builder accepts, in one place so the form (to explain a problem before saving) and the server action (to
 * refuse it) say the same thing. The database function `save_quiz_question` enforces the same rules and is the last word.
 */

const BASE58 = "[1-9A-HJ-NP-Za-km-z]{12}";

/** A question id (`qques_` and 12 base58 characters). Tier 2: sent from the builder to its own actions, never in an address, so it is not one of `ids.ts`'s prefixes. */
export const isQuestionId = (value: unknown): value is string => typeof value === "string" && new RegExp(`^qques_${BASE58}$`).test(value);

export const QUIZ_LIMITS = { prompt: 1000, option: 500, optionsMin: 2, optionsMax: 12 } as const;

/** The kinds of question the builder offers, with the words it shows for each. */
export const QUESTION_KIND_LABELS: Record<QuestionKind, string> = {
  choice: "Multiple choice or checkboxes",
  short_answer: "Short answer",
  file_upload: "File upload",
};

/** A question as the form holds it: option ids are kept for options that already exist. */
export type QuestionDraft = {
  prompt: string;
  /** Defaults to a choice question. */
  kind?: QuestionKind;
  /** Counts toward the score; defaults to graded. Only a choice question can be graded; the others are recorded, never scored. */
  graded?: boolean;
  allowsMultiple: boolean;
  options: { id?: string; label: string; isCorrect: boolean }[];
};

/** A draft with its kind and grading spelled out, as the form holds it. */
export type FullQuestionDraft = QuestionDraft & { kind: QuestionKind; graded: boolean };

export type QuestionCheck = { ok: true; input: QuizQuestionInput } | { ok: false; error: string };

/** Trims a draft and says what is wrong with it, in the words shown beside the form; the trimmed question when it is whole. */
export function checkQuestion(draft: QuestionDraft): QuestionCheck {
  const prompt = draft.prompt.trim();
  if (!prompt) return { ok: false, error: "Write the question." };
  if (prompt.length > QUIZ_LIMITS.prompt) return { ok: false, error: `Keep the question under ${QUIZ_LIMITS.prompt} characters.` };
  // A short answer or a file upload has nothing to choose from and is never scored.
  const kind = draft.kind ?? "choice";
  const graded = draft.graded ?? true;
  if (kind !== "choice") return { ok: true, input: { prompt, kind, graded: false, allowsMultiple: false, options: [] } };
  // Blank options are the empty rows people leave while typing: they are dropped, not an error.
  const options = draft.options.map((o) => ({ ...o, label: o.label.trim() })).filter((o) => o.label !== "");
  if (options.length < QUIZ_LIMITS.optionsMin) return { ok: false, error: `Give at least ${QUIZ_LIMITS.optionsMin} answers to choose from.` };
  if (options.length > QUIZ_LIMITS.optionsMax) return { ok: false, error: `Use ${QUIZ_LIMITS.optionsMax} answers or fewer.` };
  if (options.some((o) => o.label.length > QUIZ_LIMITS.option)) return { ok: false, error: `Keep each answer under ${QUIZ_LIMITS.option} characters.` };
  const correct = options.filter((o) => o.isCorrect).length;
  if (graded && correct === 0) return { ok: false, error: "Mark the right answer." };
  if (graded && !draft.allowsMultiple && correct > 1) return { ok: false, error: "Only one answer can be right unless members may choose several." };
  // An ungraded question has no right answer: whatever was marked before it was switched is dropped.
  return { ok: true, input: { prompt, kind: "choice", graded, allowsMultiple: draft.allowsMultiple, options: options.map((o) => ({ ...(o.id ? { id: o.id } : {}), label: o.label, isCorrect: graded && o.isCorrect })) } };
}

/** A new question's starting point: a graded choice question with two empty answers, the first one marked, one answer allowed. */
export function blankQuestion(kind: QuestionKind = "choice"): FullQuestionDraft {
  if (kind !== "choice") return { prompt: "", kind, graded: false, allowsMultiple: false, options: [] };
  return { prompt: "", kind, graded: true, allowsMultiple: false, options: [{ label: "", isCorrect: true }, { label: "", isCorrect: false }] };
}

/** Switching a new question to another kind starts that kind afresh, keeping the words of the question. */
export function withKind(draft: FullQuestionDraft, kind: QuestionKind): FullQuestionDraft {
  return draft.kind === kind ? draft : { ...blankQuestion(kind), prompt: draft.prompt };
}

/** Grading on or off for a choice question. Off drops the right answers, so the form never holds marks that count for nothing; on starts with the first answer marked. */
export function withGraded(draft: FullQuestionDraft, graded: boolean): FullQuestionDraft {
  if (draft.kind !== "choice" || draft.graded === graded) return draft;
  if (!graded) return { ...draft, graded, options: draft.options.map((o) => ({ ...o, isCorrect: false })) };
  return { ...draft, graded, options: draft.options.map((o, i) => ({ ...o, isCorrect: i === 0 })) };
}

/** Whether any question of the quiz counts toward the score (a graded choice question with a right answer): without one there is no score and no passing grade. */
export function hasGradedQuestions(questions: readonly { kind: QuestionKind; graded: boolean; options: readonly { isCorrect: boolean }[] }[]): boolean {
  return questions.some((q) => q.kind === "choice" && q.graded && q.options.some((o) => o.isCorrect));
}

/**
 * Turning "members may choose several" off on a question with several answers marked keeps only the first marked one, so the
 * form never holds a question the database would refuse.
 */
export function withAllowsMultiple<T extends QuestionDraft>(draft: T, allowsMultiple: boolean): T {
  if (allowsMultiple || draft.options.filter((o) => o.isCorrect).length <= 1) return { ...draft, allowsMultiple };
  let seen = false;
  return { ...draft, allowsMultiple, options: draft.options.map((o) => (o.isCorrect && !seen ? ((seen = true), o) : { ...o, isCorrect: false })) };
}

/** Marks an answer as right: the only one for a single-answer question, one more (or one fewer) for a multiple-answer one. */
export function markCorrect<T extends QuestionDraft>(draft: T, index: number, correct: boolean): T {
  return {
    ...draft,
    options: draft.options.map((o, i) => (i === index ? { ...o, isCorrect: correct } : draft.allowsMultiple ? o : { ...o, isCorrect: false })),
  };
}

export type PassingCheck = { ok: true; passingPercent: number | null } | { ok: false; error: string };

/** The passing grade typed in the settings: empty means the quiz is not graded; otherwise a whole percent from 1 to 100. */
export function parsePassingPercent(text: string): PassingCheck {
  const t = text.trim().replace(/%$/, "").trim();
  if (t === "") return { ok: true, passingPercent: null };
  if (!/^\d{1,3}$/.test(t)) return { ok: false, error: "Use a whole number from 1 to 100." };
  const n = Number(t);
  if (n < 1 || n > 100) return { ok: false, error: "Use a whole number from 1 to 100." };
  return { ok: true, passingPercent: n };
}
