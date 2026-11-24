import { resolveCourseParam } from "@/lib/courses/course-param";
import type { Repos } from "@/lib/data/repos";
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
  }));
}

/** Every attempt at the quiz, with names, for the Results tab (members looked up in one batch, never one query per row). */
export async function loadQuizResults(repos: Pick<Repos, "quizzes" | "members">, quizId: string): Promise<QuizResultRow[]> {
  const attempts = await repos.quizzes.attemptsOfQuiz(quizId);
  const members = await repos.members.byIds([...new Set(attempts.map((a) => a.memberId))]);
  return buildQuizResults(attempts, members);
}
