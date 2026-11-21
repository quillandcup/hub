"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { requireAdminAction } from "@/lib/admin-auth";
import { withAction } from "@/lib/analytics/server";
import type { ModerationAction } from "@/lib/data/course-comments";
import { notifyLessonComment } from "@/lib/courses/comment-notifications";
import { createRepos } from "@/lib/data/repos";
import { isId } from "@/lib/ids";
import { createServiceRoleClient } from "@/lib/supabase/service";

/**
 * Staff moderation of lesson comments (docs/product/COURSES.md, "Lesson comments"): hide, unhide, delete, approve a held comment,
 * dismiss its reports, mark a question handled. Each is a directly callable endpoint, so each checks the caller is an admin
 * first. They run as the signed-in admin (their own client, not the service role): the database function
 * `moderate_lesson_comment` checks the role again, changes the comment, settles its reports and writes ONE audit entry in
 * their name, with no comment text. The result carries no text either.
 */

type Auth = Extract<Awaited<ReturnType<typeof requireAdminAction>>, { ok: true }>;
export type ModerationResult = { error?: string; /** False when it was already so (nothing was written). */ changed?: boolean };

const NOT_FOUND = "That comment isn't there any more";

async function moderateImpl(auth: Auth, courseId: string, commentId: string, action: ModerationAction): Promise<ModerationResult> {
  if (!isId(courseId, "crs") || !isId(commentId, "cmnt")) return { error: NOT_FOUND };
  const repos = createRepos(auth.supabase);
  // The comment must belong to the course the admin is looking at.
  const comment = await repos.courseComments.byId(commentId);
  const lesson = comment ? await repos.courses.lessonById(comment.lessonId) : null;
  if (!comment || !lesson || lesson.course_id !== courseId) return { error: NOT_FOUND };
  try {
    const outcome = await repos.courseComments.moderate(commentId, action, null);
    if (outcome === "not_found") return { error: NOT_FOUND };
    // A reply released from review tells the people it is for now (its claim is the comment, so a repeat sends nothing twice).
    if (action === "approve" && outcome === "done" && comment.parentId) after(() => notifyLessonComment(createRepos(createServiceRoleClient()), commentId));
    revalidatePath(`/admin/courses/${courseId}/comments`, "layout");
    revalidatePath("/courses", "layout");
    return { changed: outcome === "done" };
  } catch (error) {
    // The database's own message (never the text) is enough to find it.
    console.error("lesson comment moderation failed:", error instanceof Error ? error.message : error);
    return { error: "Couldn't save that change" };
  }
}

// Usage analytics: each action records whether it worked (lib/analytics/server.ts).
/** Hides a comment from members (they see "Comment removed"); staff still read it, and it can be shown again. Settles its reports. */
export async function hideLessonComment(courseId: string, commentId: string): Promise<ModerationResult> {
  const auth = await requireAdminAction();
  if (!auth.ok) return { error: auth.error };
  return withAction("lesson_comment_hidden", () => moderateImpl(auth, courseId, commentId, "hide"));
}

/** Shows a hidden comment again. */
export async function unhideLessonComment(courseId: string, commentId: string): Promise<ModerationResult> {
  const auth = await requireAdminAction();
  if (!auth.ok) return { error: auth.error };
  return withAction("lesson_comment_unhidden", () => moderateImpl(auth, courseId, commentId, "unhide"));
}

/** Deletes a comment (a soft delete: the row stays for its retention period). Settles its reports. */
export async function deleteLessonCommentAsStaff(courseId: string, commentId: string): Promise<ModerationResult> {
  const auth = await requireAdminAction();
  if (!auth.ok) return { error: auth.error };
  return withAction("lesson_comment_deleted_by_staff", () => moderateImpl(auth, courseId, commentId, "delete"));
}

/** Releases a comment that was held for review: everyone with access to the lesson can read it. */
export async function approveHeldLessonComment(courseId: string, commentId: string): Promise<ModerationResult> {
  const auth = await requireAdminAction();
  if (!auth.ok) return { error: auth.error };
  return withAction("lesson_comment_approved", () => moderateImpl(auth, courseId, commentId, "approve"));
}

/** Marks a question as needing no answer, so it leaves the unanswered list. */
export async function markLessonCommentHandled(courseId: string, commentId: string): Promise<ModerationResult> {
  const auth = await requireAdminAction();
  if (!auth.ok) return { error: auth.error };
  return withAction("lesson_comment_handled", () => moderateImpl(auth, courseId, commentId, "handle"));
}

/** Closes the open reports on a comment and leaves the comment as it is. */
export async function dismissLessonCommentReports(courseId: string, commentId: string): Promise<ModerationResult> {
  const auth = await requireAdminAction();
  if (!auth.ok) return { error: auth.error };
  return withAction("lesson_comment_reports_dismissed", () => moderateImpl(auth, courseId, commentId, "dismiss"));
}
