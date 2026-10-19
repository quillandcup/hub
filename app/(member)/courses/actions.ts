"use server";

import { revalidatePath } from "next/cache";
import { getCoursesCaller } from "@/lib/courses/caller";
import { canOpenLessons, loadMemberCourseAccess } from "@/lib/courses/member";
import { isUuid } from "@/lib/chat/format";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service";

/**
 * Mark a lesson complete (or not). A directly callable endpoint, so it checks for itself: the
 * signed-in member with courses on, access to the lesson's course, and an open lesson. Sudo is
 * read-only, so an admin previewing as a member never changes that member's progress.
 */
export async function setLessonComplete(lessonId: string, complete: boolean): Promise<{ error?: string }> {
  if (!isUuid(lessonId)) return { error: "Lesson not found" };
  const caller = await getCoursesCaller();
  if (!caller) return { error: "Not available" };
  if (caller.identity.isSudo) return { error: "Progress can't be changed while viewing as a member" };

  const service = createServiceRoleClient();
  const { data: lesson } = await service.from("course_lessons").select("course_id, state").eq("id", lessonId).maybeSingle();
  if (!lesson || lesson.state !== "open") return { error: "Lesson not found" };
  const access = await loadMemberCourseAccess(service, caller.scope, lesson.course_id);
  if (!canOpenLessons(access)) return { error: "You don't have access to this course" };

  // Written as the member (RLS: their own rows only), not with the service role.
  const supabase = await createClient();
  const { error } = await supabase
    .from("lesson_progress")
    .upsert(
      { member_id: caller.identity.memberId, lesson_id: lessonId, completed_at: complete ? new Date().toISOString() : null },
      { onConflict: "member_id,lesson_id" }
    );
  if (error) {
    console.error("lesson_progress upsert failed:", error.message);
    return { error: "Couldn't save your progress" };
  }

  revalidatePath("/courses", "layout");
  return {};
}
