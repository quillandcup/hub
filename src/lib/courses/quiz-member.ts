import { scoreQuiz, type QuizAnswers, type ScoringQuestion } from "@/lib/courses/quiz-scoring";
import { recordLessonCompleted } from "@/lib/courses/activity";
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
  allowsMultiple: boolean;
  options: { id: string; label: string }[];
}

export interface MemberAttempt {
  id: string;
  submittedAt: string;
  scorePercent: number;
  correctCount: number;
  questionCount: number;
  passed: boolean;
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
  return {
    passingPercent: quiz.passingPercent,
    hideAnswers: quiz.hideAnswers,
    questions: questions.map((q) => ({ id: q.id, prompt: q.prompt, allowsMultiple: q.allowsMultiple, options: q.options.map((o) => ({ id: o.id, label: o.label })) })),
    attempts: attempts.slice(0, ATTEMPTS_SHOWN).map((a) => ({ id: a.id, submittedAt: a.submittedAt, scorePercent: a.scorePercent, correctCount: a.correctCount, questionCount: a.questionCount, passed: a.passed })),
    passed: attempts.some((a) => a.passed),
  };
}

/** What the browser may send: option ids by question id, bounded, so a hostile body costs nothing. */
const MAX_QUESTIONS = 200;
const MAX_PICKS = 50;
export function parseAnswers(input: unknown): QuizAnswers | null {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return null;
  const entries = Object.entries(input as Record<string, unknown>);
  if (entries.length > MAX_QUESTIONS) return null;
  const answers: Record<string, string[]> = {};
  for (const [questionId, picked] of entries) {
    if (!Array.isArray(picked) || picked.length > MAX_PICKS || !picked.every((p) => typeof p === "string" && p.length <= 40)) return null;
    answers[questionId] = picked as string[];
  }
  return answers;
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

/**
 * Scores an attempt on the server and records it; a pass (or any attempt at a quiz that isn't graded) completes the lesson, once:
 * the first completion keeps its date and writes the activity row, a later pass changes nothing. Assumes the caller has checked
 * the member may open this lesson and isn't in sudo (the action does). Never trusts the browser for anything but the picks.
 */
export async function submitQuizAttempt(
  repos: QuizMemberRepos,
  input: { memberId: string; lessonId: string; answers: QuizAnswers; now?: Date },
): Promise<SubmitOutcome> {
  const lesson = await repos.courses.lessonById(input.lessonId);
  const quiz = lesson ? await repos.quizzes.quizOfLesson(input.lessonId) : null;
  if (!lesson || !quiz) return { ok: false, error: "This isn't a quiz." };
  const stored = await repos.quizzes.questionsOf(quiz.id);
  if (stored.length === 0) return { ok: false, error: "This quiz has no questions yet." };

  const questions: ScoringQuestion[] = stored.map((q) => ({ id: q.id, allowsMultiple: q.allowsMultiple, options: q.options.map((o) => ({ id: o.id, isCorrect: o.isCorrect })) }));
  const score = scoreQuiz(questions, input.answers, quiz.passingPercent);
  const now = input.now ?? new Date();

  await repos.quizzes.recordAttempt({
    quizId: quiz.id,
    memberId: input.memberId,
    questionCount: score.questionCount,
    correctCount: score.correctCount,
    scorePercent: score.scorePercent,
    passed: score.passed,
    submittedAt: now.toISOString(),
    answers: score.results.map((r) => ({ questionId: r.questionId, selectedOptionIds: r.selectedOptionIds, isCorrect: r.correct })),
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

  const review: ReviewItem[] | null = quiz.hideAnswers
    ? null
    : score.results.map((r) => ({
        questionId: r.questionId,
        correct: r.correct,
        selectedOptionIds: r.selectedOptionIds,
        correctOptionIds: stored.find((q) => q.id === r.questionId)!.options.filter((o) => o.isCorrect).map((o) => o.id),
      }));

  return {
    ok: true,
    submission: { scorePercent: score.scorePercent, correctCount: score.correctCount, questionCount: score.questionCount, passed: score.passed, passingPercent: quiz.passingPercent, lessonComplete, review },
  };
}
