import { QUIZ_ANSWERS } from "@/lib/config";
import { scoreQuiz, type QuestionKind, type QuizAnswers, type ScoringQuestion } from "@/lib/courses/quiz-scoring";
import { checkQuizFile, isOwnQuizFilePath, type UploadedFileRef } from "@/lib/courses/quiz-files";
import { recordLessonCompleted } from "@/lib/courses/activity";
import type { AnswerFile, NewQuizAnswer } from "@/lib/data/quizzes";
import type { Repos } from "@/lib/data/repos";

type QuizMemberRepos = Pick<Repos, "quizzes" | "courses" | "courseProgress" | "activities">;

/**
 * What a member sees of a quiz. It is built field by field from the stored questions and never spreads a row, so the correct
 * answers (`isCorrect`) can't reach a browser by accident: the only way they get there is `review` in a submitted attempt's
 * result, and only when the quiz shows answers. Read with the service role after the page's own access check (members' clients
 * can't read questions or options at all: migration 20271124000000).
 */
export interface PublicQuizQuestion {
  id: string;
  prompt: string;
  kind: QuestionKind;
  allowsMultiple: boolean;
  options: { id: string; label: string }[];
}

/** What a member wrote or uploaded for one question of an attempt: their own, shown back to them. */
export interface MemberOpenAnswer {
  questionId: string;
  text: string | null;
  fileName: string | null;
}

export interface MemberAttempt {
  id: string;
  submittedAt: string;
  scorePercent: number;
  correctCount: number;
  questionCount: number;
  passed: boolean;
  /** What they wrote or uploaded in it (short answer and file upload questions only). */
  openAnswers: MemberOpenAnswer[];
}

export interface MemberQuiz {
  passingPercent: number | null;
  hideAnswers: boolean;
  questions: PublicQuizQuestion[];
  /** The member's own attempts, newest first (the last few). */
  attempts: MemberAttempt[];
  /** The member has a passing attempt (or, for a quiz that isn't graded, any attempt). */
  passed: boolean;
}

/** How many past attempts the lesson page lists. */
export const ATTEMPTS_SHOWN = 5;

/** The member's view of a lesson's quiz, or null when the lesson isn't a quiz. */
export async function loadMemberQuiz(repos: Pick<Repos, "quizzes">, lessonId: string, memberId: string): Promise<MemberQuiz | null> {
  const quiz = await repos.quizzes.quizOfLesson(lessonId);
  if (!quiz) return null;
  const [questions, attempts] = await Promise.all([repos.quizzes.questionsOf(quiz.id), repos.quizzes.attemptsOf(memberId, quiz.id)]);
  const shown = attempts.slice(0, ATTEMPTS_SHOWN);
  // Their own words and files, for the attempts listed (one batch, never a query per attempt).
  const answers = await repos.quizzes.answersOfAttempts(shown.map((a) => a.id));
  const openAnswers = (attemptId: string): MemberOpenAnswer[] =>
    answers
      .filter((a) => a.attemptId === attemptId && (a.answerText !== null || a.file !== null))
      .map((a) => ({ questionId: a.questionId, text: a.answerText, fileName: a.file?.name ?? null }));
  return {
    // A passing grade applies only when some question is scored: a quiz of reflections has none, whatever was stored.
    passingPercent: questions.some((q) => q.kind === "choice" && q.graded && q.options.some((o) => o.isCorrect)) ? quiz.passingPercent : null,
    hideAnswers: quiz.hideAnswers,
    questions: questions.map((q) => ({ id: q.id, prompt: q.prompt, kind: q.kind, allowsMultiple: q.allowsMultiple, options: q.options.map((o) => ({ id: o.id, label: o.label })) })),
    attempts: shown.map((a) => ({ id: a.id, submittedAt: a.submittedAt, scorePercent: a.scorePercent, correctCount: a.correctCount, questionCount: a.questionCount, passed: a.passed, openAnswers: openAnswers(a.id) })),
    passed: attempts.some((a) => a.passed),
  };
}

/**
 * What the browser sends for an attempt: the options picked, the text typed and the files uploaded, each by question id. Everything
 * is bounded, so a hostile body costs nothing; what a file reference really is gets checked against storage on the server.
 */
export interface SubmittedAnswers {
  picks: QuizAnswers;
  texts: Readonly<Record<string, string>>;
  files: Readonly<Record<string, UploadedFileRef>>;
}

const MAX_QUESTIONS = 200;
const MAX_PICKS = 50;

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

function parsePicks(input: unknown): QuizAnswers | null {
  if (!isRecord(input)) return null;
  const entries = Object.entries(input);
  if (entries.length > MAX_QUESTIONS) return null;
  const answers: Record<string, string[]> = {};
  for (const [questionId, picked] of entries) {
    if (!Array.isArray(picked) || picked.length > MAX_PICKS || !picked.every((p) => typeof p === "string" && p.length <= 40)) return null;
    answers[questionId] = picked as string[];
  }
  return answers;
}

/** A body of `{ picks, texts, files }` (each optional); a plain object of picks by question, as the first version sent, is read as `picks`. Null when anything is the wrong shape. */
export function parseAnswers(input: unknown): SubmittedAnswers | null {
  if (!isRecord(input)) return null;
  const structured = "picks" in input || "texts" in input || "files" in input;
  if (!structured) {
    const picks = parsePicks(input);
    return picks && { picks, texts: {}, files: {} };
  }
  const picks = input.picks === undefined ? {} : parsePicks(input.picks);
  if (!picks) return null;

  const texts: Record<string, string> = {};
  if (input.texts !== undefined) {
    if (!isRecord(input.texts) || Object.keys(input.texts).length > MAX_QUESTIONS) return null;
    for (const [questionId, text] of Object.entries(input.texts)) {
      if (typeof text !== "string" || text.length > QUIZ_ANSWERS.maxTextChars) return null;
      texts[questionId] = text;
    }
  }

  const files: Record<string, UploadedFileRef> = {};
  if (input.files !== undefined) {
    if (!isRecord(input.files) || Object.keys(input.files).length > MAX_QUESTIONS) return null;
    for (const [questionId, ref] of Object.entries(input.files)) {
      if (!isRecord(ref) || typeof ref.path !== "string" || typeof ref.name !== "string" || typeof ref.bytes !== "number" || ref.path.length > 300 || ref.name.length > 300) return null;
      files[questionId] = { path: ref.path, name: ref.name, bytes: ref.bytes };
    }
  }
  return { picks, texts, files };
}

/** One question of a submitted attempt, for the review a quiz that shows its answers gives. */
export interface ReviewItem {
  questionId: string;
  /** Null when the question had no right answer marked (it wasn't scored). */
  correct: boolean | null;
  selectedOptionIds: string[];
  correctOptionIds: string[];
}

export interface QuizSubmission {
  /** Whether any question was scored. When not, there is no score to show: the answers are recorded and the lesson is complete. */
  scored: boolean;
  scorePercent: number;
  correctCount: number;
  questionCount: number;
  passed: boolean;
  /** Whether the quiz has a passing grade (so "passed" means something) and what it is. */
  passingPercent: number | null;
  /** The lesson is complete for the member now (a pass, now or before). */
  lessonComplete: boolean;
  /** Which answers were right, or null when the quiz hides them. */
  review: ReviewItem[] | null;
}

export type SubmitOutcome = { ok: true; submission: QuizSubmission } | { ok: false; error: string };

/** Looks a member's uploaded file up in storage: its size when it is really there, null when it isn't. The action gives the service role's version. */
export type VerifyAnswerFile = (path: string) => Promise<{ bytes: number } | null>;

/**
 * Scores an attempt on the server and records it; a pass (or any attempt at a quiz that isn't graded) completes the lesson, once:
 * the first completion keeps its date and writes the activity row, a later pass changes nothing. Assumes the caller has checked
 * the member may open this lesson and isn't in sudo (the action does). Never trusts the browser for anything but the picks.
 */
export async function submitQuizAttempt(
  repos: QuizMemberRepos,
  input: { memberId: string; lessonId: string; answers: SubmittedAnswers; verifyFile: VerifyAnswerFile; now?: Date },
): Promise<SubmitOutcome> {
  const lesson = await repos.courses.lessonById(input.lessonId);
  const quiz = lesson ? await repos.quizzes.quizOfLesson(input.lessonId) : null;
  if (!lesson || !quiz) return { ok: false, error: "This isn't a quiz." };
  const stored = await repos.quizzes.questionsOf(quiz.id);
  if (stored.length === 0) return { ok: false, error: "This quiz has no questions yet." };

  // What was written and uploaded, kept apart from the picks: it is recorded, never scored.
  const open = new Map<string, { answerText: string | null; file: AnswerFile | null }>();
  for (const q of stored) {
    if (q.kind === "short_answer") {
      const text = (input.answers.texts[q.id] ?? "").trim();
      open.set(q.id, { answerText: text === "" ? null : text, file: null });
    } else if (q.kind === "file_upload") {
      const ref = input.answers.files[q.id];
      if (!ref) {
        open.set(q.id, { answerText: null, file: null });
        continue;
      }
      const checked = await checkAnswerFile(ref, input.memberId, input.verifyFile);
      if (!checked.ok) return { ok: false, error: checked.error };
      open.set(q.id, { answerText: null, file: checked.file });
    }
  }

  const questions: ScoringQuestion[] = stored.map((q) => ({ id: q.id, kind: q.kind, graded: q.graded, allowsMultiple: q.allowsMultiple, options: q.options.map((o) => ({ id: o.id, isCorrect: o.isCorrect })) }));
  const score = scoreQuiz(questions, input.answers.picks, quiz.passingPercent);
  const now = input.now ?? new Date();

  // A quiz with nothing to score completes the lesson on submitting, so an empty submission would complete it for nothing.
  const anyAnswer = score.results.some((r) => r.selectedOptionIds.length > 0) || [...open.values()].some((a) => a.answerText !== null || a.file !== null);
  if (score.questionCount === 0 && !anyAnswer) return { ok: false, error: "Answer at least one question before you submit." };

  const answers: NewQuizAnswer[] = score.results.map((r) => ({ questionId: r.questionId, selectedOptionIds: r.selectedOptionIds, isCorrect: r.correct, ...open.get(r.questionId) }));
  await repos.quizzes.recordAttempt({
    quizId: quiz.id,
    memberId: input.memberId,
    questionCount: score.questionCount,
    correctCount: score.correctCount,
    scorePercent: score.scorePercent,
    passed: score.passed,
    submittedAt: now.toISOString(),
    answers,
  });

  let lessonComplete = (await repos.courseProgress.completedLessonIds(input.memberId, [input.lessonId])).has(input.lessonId);
  if (score.passed && !lessonComplete) {
    await repos.courseProgress.setCompletion(input.memberId, input.lessonId, now.toISOString());
    lessonComplete = true;
    await recordLessonCompleted(repos, {
      memberId: input.memberId,
      lessonId: input.lessonId,
      courseId: lesson.course_id,
      lessonTitle: lesson.title,
      lessonSeconds: lesson.duration_seconds === null ? null : Number(lesson.duration_seconds),
    }, now);
  }

  // Only choice questions are reviewed: what was written or uploaded has no right answer to show.
  const review: ReviewItem[] | null = quiz.hideAnswers
    ? null
    : score.results.filter((r) => stored.find((q) => q.id === r.questionId)!.kind === "choice").map((r) => ({
        questionId: r.questionId,
        correct: r.correct,
        selectedOptionIds: r.selectedOptionIds,
        correctOptionIds: stored.find((q) => q.id === r.questionId)!.options.filter((o) => o.isCorrect).map((o) => o.id),
      }));

  return {
    ok: true,
    submission: {
      scored: score.questionCount > 0,
      scorePercent: score.scorePercent,
      correctCount: score.correctCount,
      questionCount: score.questionCount,
      passed: score.passed,
      passingPercent: score.questionCount > 0 ? quiz.passingPercent : null,
      lessonComplete,
      review,
    },
  };
}

const FILE_PROBLEM = "One of your files couldn't be found. Upload it again.";

/** A file reference from the browser, checked: the member's own path, an allowed kind, and really in storage within the size limit. */
async function checkAnswerFile(ref: UploadedFileRef, memberId: string, verify: VerifyAnswerFile): Promise<{ ok: true; file: AnswerFile } | { ok: false; error: string }> {
  if (!isOwnQuizFilePath(memberId, ref.path)) return { ok: false, error: FILE_PROBLEM };
  const found = await verify(ref.path);
  if (!found) return { ok: false, error: FILE_PROBLEM };
  // What storage says counts, not what the browser claimed.
  const stored = ref.path.slice(ref.path.lastIndexOf("/") + 1);
  const name = ref.name.trim() || stored;
  // Both the name shown back and the name stored must be an allowed kind (the browser could claim one and upload another).
  const check = checkQuizFile(stored, found.bytes);
  if (!check.ok) return { ok: false, error: check.error };
  const shown = checkQuizFile(name, found.bytes);
  if (!shown.ok) return { ok: false, error: shown.error };
  return { ok: true, file: { path: ref.path, name: name.slice(0, 200), bytes: found.bytes } };
}
