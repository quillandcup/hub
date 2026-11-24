import { resolveCourseParam } from "@/lib/courses/course-param";
import type { Repos } from "@/lib/data/repos";
import { hasGradedQuestions } from "@/lib/courses/quiz-editor";
import type { QuizAttemptRecord, QuizQuestionRecord, QuizRecord } from "@/lib/data/quizzes";
import { isId } from "@/lib/ids";
import { getMemberDisplayName } from "@/lib/member-display-name";

type AdminQuizRepos = Pick<Repos, "courses" | "quizzes" | "members">;

/** A quiz lesson as its builder pages show it. */
export interface AdminQuiz {
  course: { id: string; title: string };
  lesson: { id: string; title: string };
  /** The quiz is in a Hub-owned lesson: its questions and settings can be changed here. An imported quiz is shown as Kajabi has it. */
  editable: boolean;
  quiz: QuizRecord;
  questions: QuizQuestionRecord[];
  /** Some question counts toward the score; without one the quiz has no score and no passing grade applies. */
  hasGradedQuestions: boolean;
  /** Some question takes words or a file, so a member's answers are worth opening from the Results tab. */
  hasOpenQuestions: boolean;
  /** Attempts members have made, for what removing the quiz would delete. */
  attemptCount: number;
}

/** The quiz of a lesson of the course (by id or slug), or null when the course or lesson isn't there or the lesson isn't a quiz. Staff only: it holds the correct answers. */
export async function loadAdminQuiz(repos: AdminQuizRepos, courseParam: string, lessonId: string): Promise<AdminQuiz | null> {
  const courseId = await resolveCourseParam(repos, courseParam);
  if (!isId(courseId, "crs") || !isId(lessonId, "les")) return null;
  const [lesson, course, quiz] = await Promise.all([repos.courses.lessonById(lessonId), repos.courses.courseById(courseId), repos.quizzes.quizOfLesson(lessonId)]);
  if (!lesson || lesson.course_id !== courseId || !course || !quiz) return null;
  const [questions, attempts] = await Promise.all([repos.quizzes.questionsOf(quiz.id), repos.quizzes.attemptCountsOfLessons([lessonId])]);
  return {
    course: { id: courseId, title: course.title },
    lesson: { id: lessonId, title: lesson.title },
    editable: lesson.source === "hub",
    quiz,
    questions,
    hasGradedQuestions: hasGradedQuestions(questions),
    hasOpenQuestions: questions.some((q) => q.kind !== "choice"),
    attemptCount: attempts.get(lessonId) ?? 0,
  };
}

/** Whether the lesson is a quiz, for the lesson page (which then offers the quiz tabs). */
export async function isQuizLesson(repos: Pick<Repos, "quizzes">, lessonId: string): Promise<boolean> {
  return (await repos.quizzes.quizOfLesson(lessonId)) !== null;
}

/** One line of the Results tab. */
export interface QuizResultRow {
  attemptId: string;
  memberId: string;
  name: string;
  submittedAt: string;
  scorePercent: number;
  correctCount: number;
  questionCount: number;
  passed: boolean;
  /** `kajabi` for an attempt imported from Kajabi's Results tab, null for one made in the Hub. */
  importedFrom: string | null;
}

/** A member's best attempt first is not what staff read here: newest first, as submitted, each with the member shown by their display name. Pure. */
export function buildQuizResults(attempts: QuizAttemptRecord[], members: { id: string; name: string; displayName: string | null }[]): QuizResultRow[] {
  const names = new Map(members.map((m) => [m.id, getMemberDisplayName({ name: m.name, display_name: m.displayName })]));
  return attempts.map((a) => ({
    attemptId: a.id,
    memberId: a.memberId,
    name: names.get(a.memberId) ?? "Former member",
    submittedAt: a.submittedAt,
    scorePercent: a.scorePercent,
    correctCount: a.correctCount,
    questionCount: a.questionCount,
    passed: a.passed,
    importedFrom: a.importedFrom,
  }));
}

/** Every attempt at the quiz, with names, for the Results tab (members looked up in one batch, never one query per row). */
export async function loadQuizResults(repos: Pick<Repos, "quizzes" | "members">, quizId: string): Promise<QuizResultRow[]> {
  const attempts = await repos.quizzes.attemptsOfQuiz(quizId);
  const members = await repos.members.byIds([...new Set(attempts.map((a) => a.memberId))]);
  return buildQuizResults(attempts, members);
}

/** One answer of an attempt, as staff read it: the question as it is now, what the member picked, wrote and uploaded. */
export interface AttemptAnswerView {
  questionId: string;
  /** The question as it was worded when the member answered it (an imported answer carries that; otherwise the question now). */
  prompt: string;
  kind: QuizQuestionRecord["kind"];
  /** The labels of the options picked (a choice question). */
  picked: string[];
  /** Whether it was right; null when the question wasn't scored. */
  correct: boolean | null;
  text: string | null;
  file: { name: string; bytes: number } | null;
}

export interface AttemptView {
  result: QuizResultRow;
  answers: AttemptAnswerView[];
}

/**
 * One member's attempt with every answer, for the Results tab (staff only: it is the member's own writing and files). Null when the
 * attempt isn't at this quiz. A question deleted since is left out, since its answers went with it.
 */
export async function loadAttemptView(repos: Pick<Repos, "quizzes" | "members">, quizId: string, attemptId: string): Promise<AttemptView | null> {
  const attempt = await repos.quizzes.attemptById(attemptId);
  if (!attempt || attempt.quizId !== quizId) return null;
  const [questions, answers, members] = await Promise.all([
    repos.quizzes.questionsOf(quizId),
    repos.quizzes.answersOfAttempts([attemptId]),
    repos.members.byIds([attempt.memberId]),
  ]);
  const [result] = buildQuizResults([attempt], members);
  const byQuestion = new Map(answers.map((a) => [a.questionId, a]));
  return {
    result,
    answers: questions.map((q) => {
      const a = byQuestion.get(q.id);
      return {
        questionId: q.id,
        prompt: a?.promptSnapshot ?? q.prompt,
        kind: q.kind,
        picked: q.options.filter((o) => a?.selectedOptionIds.includes(o.id)).map((o) => o.label),
        correct: a?.isCorrect ?? null,
        text: a?.answerText ?? null,
        file: a?.file ? { name: a.file.name, bytes: a.file.bytes } : null,
      };
    }),
  };
}
