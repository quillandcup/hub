"use server";

import { revalidatePath } from "next/cache";
import { requireAdminAction } from "@/lib/admin-auth";
import { getCoursesCaller } from "@/lib/courses/caller";
import { recordLessonCompleted } from "@/lib/courses/activity";
import { canOpenLessons, loadMemberCourseAccess } from "@/lib/courses/member";
import { createRepos } from "@/lib/data/repos";
import { isId } from "@/lib/ids";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service";

import { withAction } from "@/lib/analytics/server";
/**
 * Mark a lesson complete (or not). A directly callable endpoint, so it checks for itself: the
 * signed-in member with courses on, access to the lesson's course, and an open lesson. Sudo is
 * read-only, so an admin previewing as a member never changes that member's progress.
 */
async function setLessonCompleteImpl(lessonId: string, complete: boolean): Promise<{ error?: string }> {
  if (!isId(lessonId, "les")) return { error: "Lesson not found" };
  const caller = await getCoursesCaller();
  if (!caller) return { error: "Not available" };
  if (caller.identity.isSudo) return { error: "Progress can't be changed while viewing as a member" };

  const service = createServiceRoleClient();
  const lesson = await createRepos(service).courses.lessonById(lessonId);
  if (!lesson || lesson.state !== "open") return { error: "Lesson not found" };
  const access = await loadMemberCourseAccess(createRepos(service), caller.scope, lesson.course_id);
  if (!canOpenLessons(access)) return { error: "You don't have access to this course" };

  // Written as the member (RLS: their own rows only), not with the service role.
  const supabase = await createClient();
  try {
    await createRepos(supabase).courseProgress.setCompletion(caller.identity.memberId, lessonId, complete ? new Date().toISOString() : null);
  } catch (error) {
    console.error("lesson_progress upsert failed:", error instanceof Error ? error.message : error);
    return { error: "Couldn't save your progress" };
  }
  if (complete) {
    await recordLessonCompleted(createRepos(supabase), { memberId: caller.identity.memberId, lessonId, courseId: lesson.course_id, lessonTitle: lesson.title, lessonSeconds: lesson.duration_seconds === null ? null : Number(lesson.duration_seconds) });
  }

  revalidatePath("/courses", "layout");
  return {};
}

/**
 * Staff only: wipes the signed-in staff member's own viewing record for one lesson (their watch
 * segments for its video, and their progress row: position and completion), so they can test the
 * lesson as new. Never a member's: it needs an admin acting as themselves (not sudo), and it is
 * scoped to that staff member's own member id, which comes from the session, not the request.
 * Members can't do this to themselves: their watch history is append-only.
 */
export async function clearMyLessonProgress(lessonId: string): Promise<{ error?: string; segments?: number }> {
  const auth = await requireAdminAction();
  if (!auth.ok) return { error: auth.error };
  if (!isId(lessonId, "les")) return { error: "Lesson not found" };
  const caller = await getCoursesCaller();
  if (!caller || !caller.scope.isAdminActing) return { error: "Not available" };

  const service = createServiceRoleClient();
  const repos = createRepos(service);
  const lesson = await repos.courses.lessonById(lessonId);
  if (!lesson) return { error: "Lesson not found" };
  const memberId = caller.identity.memberId;

  let segments = 0;
  if (lesson.video_id) {
    try {
      segments = await repos.courseProgress.clearSegments(memberId, lesson.video_id);
    } catch (error) {
      console.error("video_watch_segments delete failed:", error instanceof Error ? error.message : error);
      return { error: "Couldn't clear your progress" };
    }
  }
  try {
    await repos.courseProgress.clearProgress(memberId, lessonId);
  } catch (error) {
    console.error("lesson_progress delete failed:", error instanceof Error ? error.message : error);
    return { error: "Couldn't clear your progress" };
  }

  revalidatePath("/courses", "layout");
  return { segments };
}

// Usage analytics: each action records whether it worked (lib/analytics/server.ts).
export async function setLessonComplete(...args: Parameters<typeof setLessonCompleteImpl>): ReturnType<typeof setLessonCompleteImpl> {
  return withAction("lesson_completion_saved", () => setLessonCompleteImpl(...args));
}
