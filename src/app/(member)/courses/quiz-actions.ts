"use server";

import { revalidatePath } from "next/cache";
import { withAction } from "@/lib/analytics/server";
import { getCoursesCaller } from "@/lib/courses/caller";
import { canOpenLessons, loadMemberCourseAccess } from "@/lib/courses/member";
import { parseAnswers, submitQuizAttempt, type QuizSubmission } from "@/lib/courses/quiz-member";
import { createRepos } from "@/lib/data/repos";
import { isId } from "@/lib/ids";
import { createServiceRoleClient } from "@/lib/supabase/service";

export type SubmitQuizResult = { error?: string; submission?: QuizSubmission };

/**
 * A member submits their answers to a lesson's quiz. A directly callable endpoint, so it checks for itself, like marking a lesson
 * complete: the signed-in member with courses on, access to the lesson's course, an open lesson, and not sudo (read-only). Only the
 * picks come from the browser; the server reads the questions and the right answers, scores, records the attempt and, on a pass
 * (or any attempt at a quiz with no passing grade), completes the lesson. The attempt and the completion are written with the
 * service role, which is the only way a quiz lesson is completed (a trigger refuses the member's own client).
 */
async function submitImpl(lessonId: string, rawAnswers: unknown): Promise<SubmitQuizResult> {
  if (!isId(lessonId, "les")) return { error: "Lesson not found" };
  const answers = parseAnswers(rawAnswers);
  if (!answers) return { error: "Those answers couldn't be read. Reload the page and try again." };
  const caller = await getCoursesCaller();
  if (!caller) return { error: "Not available" };
  if (caller.identity.isSudo) return { error: "Quizzes can't be taken while viewing as a member" };

  const repos = createRepos(createServiceRoleClient());
  const lesson = await repos.courses.lessonById(lessonId);
  // A lesson members can't open yet (coming soon, a draft) isn't theirs to answer, staff previewing it included: progress isn't tracked there.
  if (!lesson || lesson.state !== "open") return { error: "Lesson not found" };
  const access = await loadMemberCourseAccess(repos, caller.scope, lesson.course_id);
  if (!canOpenLessons(access)) return { error: "You don't have access to this course" };

  try {
    const outcome = await submitQuizAttempt(repos, { memberId: caller.identity.memberId, lessonId, answers });
    if (!outcome.ok) return { error: outcome.error };
    revalidatePath("/courses", "layout");
    return { submission: outcome.submission };
  } catch (error) {
    console.error("quiz attempt failed:", error instanceof Error ? error.message : error);
    return { error: "Couldn't save your answers. Try again." };
  }
}

// Usage analytics: each action records whether it worked (src/lib/analytics/server.ts).
export async function submitQuiz(lessonId: string, answers: Record<string, string[]>): Promise<SubmitQuizResult> {
  return withAction("quiz_attempt_submitted", () => submitImpl(lessonId, answers));
}
