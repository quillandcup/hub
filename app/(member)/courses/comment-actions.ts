"use server";

import { revalidatePath } from "next/cache";
import { withAction } from "@/lib/analytics/server";
import { clock } from "@/lib/clock";
import { getCoursesCaller } from "@/lib/courses/caller";
import { COMMENT_RATE_LIMITS, cleanCommentBody, isRemovedComment, lessonOpenForComments, withinEditWindow } from "@/lib/courses/comments";
import { createRepos } from "@/lib/data/repos";
import { effectiveMemberHasFeature, getUserFeaturePreviews } from "@/lib/features.server";
import { isId } from "@/lib/ids";
import { createServiceRoleClient } from "@/lib/supabase/service";

/**
 * Lesson comments: post, reply, edit and delete your own (docs/COURSES.md, "Lesson comments"). Each is a directly callable
 * endpoint, so each checks for itself: a signed-in member with courses on, a lesson they may open (open, course not a draft,
 * current access or staff acting as themselves), and not sudo, which is read-only. They write with the service role scoped to the
 * verified effective member, like the other course actions; row-level security is the second layer. The text is never
 * logged and never sent to analytics: the outcome event carries no content.
 */

const NOT_AVAILABLE = "Comments aren't available on this lesson";

export type CommentResult = { error?: string; id?: string };

/** The `lesson_comments` flag, for the member the caller is acting as: with it off, nothing about comments works. */
async function commentsOn(caller: NonNullable<Awaited<ReturnType<typeof getCoursesCaller>>>): Promise<boolean> {
  return effectiveMemberHasFeature("lesson_comments", caller.identity, await getUserFeaturePreviews(caller.userId));
}

async function postLessonCommentImpl(lessonId: string, rawBody: string, parentId: string | null): Promise<CommentResult> {
  if (!isId(lessonId, "les") || (parentId !== null && !isId(parentId, "cmnt"))) return { error: NOT_AVAILABLE };
  const caller = await getCoursesCaller();
  if (!caller) return { error: "Not available" };
  if (caller.identity.isSudo) return { error: "Read-only while previewing" };
  if (!(await commentsOn(caller))) return { error: NOT_AVAILABLE };

  const repos = createRepos(createServiceRoleClient());
  const open = await lessonOpenForComments(repos, caller, lessonId);
  if (!open) return { error: NOT_AVAILABLE };

  const cleaned = cleanCommentBody(rawBody);
  if ("error" in cleaned) return { error: cleaned.error };

  // A reply goes under a top-level comment on this lesson; replying to a reply attaches to the comment above it.
  let attachTo: string | null = null;
  if (parentId) {
    const parent = await repos.courseComments.byId(parentId);
    if (!parent || parent.lessonId !== lessonId || isRemovedComment(parent)) return { error: "That comment is no longer there" };
    attachTo = parent.parentId ?? parent.id;
    if (parent.parentId) {
      const top = await repos.courseComments.byId(parent.parentId);
      if (!top || isRemovedComment(top)) return { error: "That comment is no longer there" };
    }
  }

  const memberId = caller.identity.memberId;
  for (const limit of COMMENT_RATE_LIMITS) {
    const within = await repos.rateLimit.hit(`lesson_comment:${limit.name}:${memberId}`, limit.windowSeconds, limit.maxHits);
    if (!within) return { error: "You're posting quickly. Try again in a little while." };
  }

  try {
    const comment = await repos.courseComments.create({
      lessonId,
      memberId,
      parentId: attachTo,
      body: cleaned.body,
      isStaffReply: caller.scope.isAdminActing,
    });
    revalidatePath("/courses", "layout");
    return { id: comment.id };
  } catch (error) {
    // The database's own message (never the text) is enough to find it.
    console.error("lesson_comments insert failed:", error instanceof Error ? error.message : error);
    return { error: "Couldn't post your comment" };
  }
}

async function editLessonCommentImpl(commentId: string, rawBody: string): Promise<CommentResult> {
  if (!isId(commentId, "cmnt")) return { error: NOT_AVAILABLE };
  const caller = await getCoursesCaller();
  if (!caller) return { error: "Not available" };
  if (caller.identity.isSudo) return { error: "Read-only while previewing" };
  if (!(await commentsOn(caller))) return { error: NOT_AVAILABLE };

  const repos = createRepos(createServiceRoleClient());
  const comment = await repos.courseComments.byId(commentId);
  // Someone else's comment looks the same as one that isn't there.
  if (!comment || comment.memberId !== caller.identity.memberId || isRemovedComment(comment)) return { error: NOT_AVAILABLE };
  if (!(await lessonOpenForComments(repos, caller, comment.lessonId))) return { error: NOT_AVAILABLE };
  if (!withinEditWindow(comment.createdAt, clock.now())) return { error: "Comments can be edited for 15 minutes after you post them" };

  const cleaned = cleanCommentBody(rawBody);
  if ("error" in cleaned) return { error: cleaned.error };

  try {
    await repos.courseComments.edit(commentId, cleaned.body, new Date(clock.now()).toISOString());
    revalidatePath("/courses", "layout");
    return { id: commentId };
  } catch (error) {
    console.error("lesson_comments update failed:", error instanceof Error ? error.message : error);
    return { error: "Couldn't save your change" };
  }
}

async function deleteLessonCommentImpl(commentId: string): Promise<CommentResult> {
  if (!isId(commentId, "cmnt")) return { error: NOT_AVAILABLE };
  const caller = await getCoursesCaller();
  if (!caller) return { error: "Not available" };
  if (caller.identity.isSudo) return { error: "Read-only while previewing" };
  if (!(await commentsOn(caller))) return { error: NOT_AVAILABLE };

  const repos = createRepos(createServiceRoleClient());
  const comment = await repos.courseComments.byId(commentId);
  if (!comment || comment.memberId !== caller.identity.memberId || isRemovedComment(comment)) return { error: NOT_AVAILABLE };
  if (!(await lessonOpenForComments(repos, caller, comment.lessonId))) return { error: NOT_AVAILABLE };

  try {
    await repos.courseComments.softDelete(commentId, caller.identity.memberId, new Date(clock.now()).toISOString());
    revalidatePath("/courses", "layout");
    return { id: commentId };
  } catch (error) {
    console.error("lesson_comments delete failed:", error instanceof Error ? error.message : error);
    return { error: "Couldn't delete your comment" };
  }
}

// Usage analytics: each action records whether it worked (lib/analytics/server.ts).
export async function postLessonComment(...args: Parameters<typeof postLessonCommentImpl>): ReturnType<typeof postLessonCommentImpl> {
  return withAction("lesson_comment_posted", () => postLessonCommentImpl(...args));
}

export async function editLessonComment(...args: Parameters<typeof editLessonCommentImpl>): ReturnType<typeof editLessonCommentImpl> {
  return withAction("lesson_comment_edited", () => editLessonCommentImpl(...args));
}

export async function deleteLessonComment(...args: Parameters<typeof deleteLessonCommentImpl>): ReturnType<typeof deleteLessonCommentImpl> {
  return withAction("lesson_comment_deleted", () => deleteLessonCommentImpl(...args));
}
