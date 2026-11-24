import type { QuizQuestionInput } from "@/lib/data/quizzes";

/**
 * What the quiz builder accepts, in one place so the form (to explain a problem before saving) and the server action (to
 * refuse it) say the same thing. The database function `save_quiz_question` enforces the same rules and is the last word.
 */

const BASE58 = "[1-9A-HJ-NP-Za-km-z]{12}";

/** A question id (`qques_` and 12 base58 characters). Tier 2: sent from the builder to its own actions, never in an address, so it is not one of `ids.ts`'s prefixes. */
export const isQuestionId = (value: unknown): value is string => typeof value === "string" && new RegExp(`^qques_${BASE58}$`).test(value);

export const QUIZ_LIMITS = { prompt: 1000, option: 500, optionsMin: 2, optionsMax: 12 } as const;

/** A question as the form holds it: option ids are kept for options that already exist. */
export type QuestionDraft = {
  prompt: string;
  allowsMultiple: boolean;
  options: { id?: string; label: string; isCorrect: boolean }[];
};

export type QuestionCheck = { ok: true; input: QuizQuestionInput } | { ok: false; error: string };

/** Trims a draft and says what is wrong with it, in the words shown beside the form; the trimmed question when it is whole. */
export function checkQuestion(draft: QuestionDraft): QuestionCheck {
  const prompt = draft.prompt.trim();
  if (!prompt) return { ok: false, error: "Write the question." };
  if (prompt.length > QUIZ_LIMITS.prompt) return { ok: false, error: `Keep the question under ${QUIZ_LIMITS.prompt} characters.` };
  // Blank options are the empty rows people leave while typing: they are dropped, not an error.
  const options = draft.options.map((o) => ({ ...o, label: o.label.trim() })).filter((o) => o.label !== "");
  if (options.length < QUIZ_LIMITS.optionsMin) return { ok: false, error: `Give at least ${QUIZ_LIMITS.optionsMin} answers to choose from.` };
  if (options.length > QUIZ_LIMITS.optionsMax) return { ok: false, error: `Use ${QUIZ_LIMITS.optionsMax} answers or fewer.` };
  if (options.some((o) => o.label.length > QUIZ_LIMITS.option)) return { ok: false, error: `Keep each answer under ${QUIZ_LIMITS.option} characters.` };
  const correct = options.filter((o) => o.isCorrect).length;
  if (correct === 0) return { ok: false, error: "Mark the right answer." };
  if (!draft.allowsMultiple && correct > 1) return { ok: false, error: "Only one answer can be right unless members may choose several." };
  return { ok: true, input: { prompt, allowsMultiple: draft.allowsMultiple, options: options.map((o) => ({ ...(o.id ? { id: o.id } : {}), label: o.label, isCorrect: o.isCorrect })) } };
}

/** A new question's starting point: two empty answers, the first one marked, one answer allowed. */
export function blankQuestion(): QuestionDraft {
  return { prompt: "", allowsMultiple: false, options: [{ label: "", isCorrect: true }, { label: "", isCorrect: false }] };
}

/**
 * Turning "members may choose several" off on a question with several answers marked keeps only the first marked one, so the
 * form never holds a question the database would refuse.
 */
export function withAllowsMultiple(draft: QuestionDraft, allowsMultiple: boolean): QuestionDraft {
  if (allowsMultiple || draft.options.filter((o) => o.isCorrect).length <= 1) return { ...draft, allowsMultiple };
  let seen = false;
  return { ...draft, allowsMultiple, options: draft.options.map((o) => (o.isCorrect && !seen ? ((seen = true), o) : { ...o, isCorrect: false })) };
}

/** Marks an answer as right: the only one for a single-answer question, one more (or one fewer) for a multiple-answer one. */
export function markCorrect(draft: QuestionDraft, index: number, correct: boolean): QuestionDraft {
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
