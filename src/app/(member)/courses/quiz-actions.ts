"use server";

import { revalidatePath } from "next/cache";
import { withAction } from "@/lib/analytics/server";
import { getCoursesCaller, type CoursesCaller } from "@/lib/courses/caller";
import { canOpenLessons, loadMemberCourseAccess } from "@/lib/courses/member";
import { checkQuizFile, newQuizFilePath } from "@/lib/courses/quiz-files";
import { quizFileSize, signQuizFileUpload } from "@/lib/courses/quiz-files-storage";
import { parseAnswers, submitQuizAttempt, type QuizSubmission } from "@/lib/courses/quiz-member";
import { isQuestionId } from "@/lib/courses/quiz-editor";
import { createRepos, type Repos } from "@/lib/data/repos";
import { isId } from "@/lib/ids";
import { createServiceRoleClient } from "@/lib/supabase/service";

export type SubmitQuizResult = { error?: string; submission?: QuizSubmission };
export type PrepareQuizFileResult = { error?: string; path?: string; token?: string };

type Gate = { ok: true; caller: CoursesCaller; repos: Repos; service: ReturnType<typeof createServiceRoleClient>; lesson: NonNullable<Awaited<ReturnType<Repos["courses"]["lessonById"]>>> } | { ok: false; error: string };

/**
 * The checks every quiz action makes for itself (they are directly callable endpoints, like marking a lesson complete): the signed-in
 * member with courses on, not sudo (read-only), a lesson members can open (coming soon and draft lessons are not theirs to answer,
 * staff previewing them included: progress isn't tracked there), and access to the lesson's course.
 */
async function gate(lessonId: string): Promise<Gate> {
  if (!isId(lessonId, "les")) return { ok: false, error: "Lesson not found" };
  const caller = await getCoursesCaller();
  if (!caller) return { ok: false, error: "Not available" };
  if (caller.identity.isSudo) return { ok: false, error: "Quizzes can't be taken while viewing as a member" };
  const service = createServiceRoleClient();
  const repos = createRepos(service);
  const lesson = await repos.courses.lessonById(lessonId);
  if (!lesson || lesson.state !== "open") return { ok: false, error: "Lesson not found" };
  const access = await loadMemberCourseAccess(repos, caller.scope, lesson.course_id);
  if (!canOpenLessons(access)) return { ok: false, error: "You don't have access to this course" };
  return { ok: true, caller, repos, service, lesson };
}

/**
 * A member submits their answers to a lesson's quiz. Only what they picked, wrote and uploaded comes from the browser; the server
 * reads the questions and the right answers, scores, records the attempt and, on a pass (a quiz with nothing to score passes
 * whenever something was answered), completes the lesson. The attempt and the completion are written with the service role, which is
 * the only way a quiz lesson is completed (a trigger refuses the member's own client). A file is accepted only when it is in the
 * member's own folder and really in storage.
 */
async function submitImpl(lessonId: string, rawAnswers: unknown): Promise<SubmitQuizResult> {
  const answers = parseAnswers(rawAnswers);
  if (!answers) return { error: "Those answers couldn't be read. Reload the page and try again." };
  const g = await gate(lessonId);
  if (!g.ok) return { error: g.error };

  try {
    const outcome = await submitQuizAttempt(g.repos, {
      memberId: g.caller.identity.memberId,
      lessonId,
      answers,
      verifyFile: (path) => quizFileSize(g.service, path),
    });
    if (!outcome.ok) return { error: outcome.error };
    revalidatePath("/courses", "layout");
    return { submission: outcome.submission };
  } catch (error) {
    console.error("quiz attempt failed:", error instanceof Error ? error.message : error);
    return { error: "Couldn't save your answers. Try again." };
  }
}

/**
 * A place for the browser to put a file answer: one signed upload for one path in the member's own folder of the private bucket
 * (the file goes straight to storage; a server action can't take a big body). The name and size are checked here and again, against
 * storage itself, when the quiz is submitted.
 */
async function prepareFileImpl(lessonId: string, questionId: string, file: { name: string; size: number }): Promise<PrepareQuizFileResult> {
  if (!isQuestionId(questionId) || typeof file?.name !== "string" || typeof file?.size !== "number") return { error: "That file can't be uploaded." };
  const g = await gate(lessonId);
  if (!g.ok) return { error: g.error };
  const checked = checkQuizFile(file.name, file.size);
  if (!checked.ok) return { error: checked.error };

  // The question must be a file question of this lesson's quiz: no uploads for anything else.
  const quiz = await g.repos.quizzes.quizOfLesson(lessonId);
  const question = quiz ? (await g.repos.quizzes.questionsOf(quiz.id)).find((q) => q.id === questionId) : undefined;
  if (!question || question.kind !== "file_upload") return { error: "That question doesn't take a file." };

  const path = newQuizFilePath(g.caller.identity.memberId, file.name, crypto.randomUUID());
  const signed = await signQuizFileUpload(g.service, path);
  if (!signed) return { error: "Couldn't start the upload. Try again." };
  return { path, token: signed.token };
}

// Usage analytics: each action records whether it worked (src/lib/analytics/server.ts).
export async function submitQuiz(lessonId: string, answers: unknown): Promise<SubmitQuizResult> {
  return withAction("quiz_attempt_submitted", () => submitImpl(lessonId, answers));
}

export async function prepareQuizFileUpload(lessonId: string, questionId: string, file: { name: string; size: number }): Promise<PrepareQuizFileResult> {
  return withAction("quiz_file_upload_prepared", () => prepareFileImpl(lessonId, questionId, file));
}
