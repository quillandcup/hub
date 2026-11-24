"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { withAction } from "@/lib/analytics/server";
import { clock } from "@/lib/clock";
import { getCoursesCaller } from "@/lib/courses/caller";
import { notifyLessonComment } from "@/lib/courses/comment-notifications";
import { mentionError, suggestMentionable, type MentionChoice } from "@/lib/courses/comment-mentions";
import { COMMENT_MAX_LINKS, COMMENT_RATE_LIMITS, REPORT_RATE_LIMIT, cleanCommentBody, cleanReportReason, isRemovedComment, lessonOpenForComments, shouldHoldComment, withinEditWindow } from "@/lib/courses/comments";
import { createRepos } from "@/lib/data/repos";
import { effectiveMemberHasFeature, getUserFeaturePreviews } from "@/lib/features.server";
import { isId } from "@/lib/ids";
import { createServiceRoleClient } from "@/lib/supabase/service";

/**
 * Lesson comments: post, reply, edit and delete your own, and report someone else's (docs/product/COURSES.md, "Lesson comments"). Each is a directly callable
 * endpoint, so each checks for itself: a signed-in member with courses on, a lesson they may open (open, course not a draft,
 * current access or staff acting as themselves), and not sudo, which is read-only. They write with the service role scoped to the
 * verified effective member, like the other course actions; row-level security is the second layer. The text is never
 * logged and never sent to analytics: the outcome event carries no content.
 */

const NOT_AVAILABLE = "Comments aren't available on this lesson";

export type CommentResult = {
  error?: string;
  id?: string;
  /** Posted, but held for staff review (more than two links): only its author and staff see it until it is approved. */
  held?: boolean;
};

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
  const badMention = await mentionError(repos, open.courseId, cleaned.body);
  if (badMention) return { error: badMention };

  // A reply goes under a top-level comment on this lesson; replying to a reply attaches to the comment above it.
  let attachTo: string | null = null;
  if (parentId) {
    const parent = await repos.courseComments.byId(parentId);
    if (!parent || parent.lessonId !== lessonId || isRemovedComment(parent) || parent.heldAt) return { error: "That comment is no longer there" };
    attachTo = parent.parentId ?? parent.id;
    if (parent.parentId) {
      const top = await repos.courseComments.byId(parent.parentId);
      if (!top || isRemovedComment(top) || top.heldAt) return { error: "That comment is no longer there" };
    }
  }

  const memberId = caller.identity.memberId;
  for (const limit of COMMENT_RATE_LIMITS) {
    const within = await repos.rateLimit.hit(`lesson_comment:${limit.name}:${memberId}`, limit.windowSeconds, limit.maxHits);
    if (!within) return { error: "You're posting quickly. Try again in a little while." };
  }

  // More than two links goes to staff first (never staff's own); no word filter, which mangles writing talk.
  const held = !caller.scope.isAdminActing && shouldHoldComment(cleaned.body);
  try {
    // The Instructor badge is for this course's instructors only: staff who are not on its list post as ordinary members.
    const isInstructorReply = await repos.courseInstructors.isInstructor(open.courseId, memberId);
    const comment = await repos.courseComments.create({
      lessonId,
      memberId,
      parentId: attachTo,
      body: cleaned.body,
      isInstructorReply,
      held,
    });
    // Posting follows the lesson (unless the member already chose), and a reply tells the people it is for: after the response, so
    // the post never waits on Slack. Never throws; a held comment tells no one until staff release it.
    await repos.courseComments.ensureFollowing(memberId, lessonId).catch((error) => console.error("lesson_comment_follows insert failed:", error instanceof Error ? error.message : error));
    if (!held) after(() => notifyLessonComment(createRepos(createServiceRoleClient()), comment.id));
    revalidatePath("/courses", "layout");
    return held ? { id: comment.id, held: true } : { id: comment.id };
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
  const open = await lessonOpenForComments(repos, caller, comment.lessonId);
  if (!open) return { error: NOT_AVAILABLE };
  if (!withinEditWindow(comment.createdAt, clock.now())) return { error: "Comments can be edited for 15 minutes after you post them" };

  const cleaned = cleanCommentBody(rawBody);
  if ("error" in cleaned) return { error: cleaned.error };
  // An edit can't be used to slip past the link rule.
  if (!caller.scope.isAdminActing && shouldHoldComment(cleaned.body)) return { error: `Comments can have up to ${COMMENT_MAX_LINKS} links` };
  const badMention = await mentionError(repos, open.courseId, cleaned.body);
  if (badMention) return { error: badMention };

  try {
    await repos.courseComments.edit(commentId, cleaned.body, new Date(clock.now()).toISOString());
    // Someone mentioned by the edit is told (each person once per comment); replies were told when it was posted.
    if (!comment.heldAt) after(() => notifyLessonComment(createRepos(createServiceRoleClient()), commentId, new Date(clock.now()), "mentions"));
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

async function reportLessonCommentImpl(commentId: string, rawReason: string): Promise<CommentResult> {
  if (!isId(commentId, "cmnt")) return { error: NOT_AVAILABLE };
  const caller = await getCoursesCaller();
  if (!caller) return { error: "Not available" };
  if (caller.identity.isSudo) return { error: "Read-only while previewing" };
  if (!(await commentsOn(caller))) return { error: NOT_AVAILABLE };

  const repos = createRepos(createServiceRoleClient());
  const comment = await repos.courseComments.byId(commentId);
  // A comment that is gone, hidden or held for review looks the same as one that never was.
  if (!comment || isRemovedComment(comment) || comment.heldAt) return { error: NOT_AVAILABLE };
  if (!(await lessonOpenForComments(repos, caller, comment.lessonId))) return { error: NOT_AVAILABLE };
  // Staff hide or delete directly; nobody reports their own words.
  if (caller.scope.isAdminActing) return { error: "Staff can hide or delete comments from the moderation queue" };
  if (comment.memberId === caller.identity.memberId) return { error: "You can't report your own comment" };

  const cleaned = cleanReportReason(rawReason);
  if ("error" in cleaned) return { error: cleaned.error };

  const memberId = caller.identity.memberId;
  for (const limit of REPORT_RATE_LIMIT) {
    const within = await repos.rateLimit.hit(`lesson_comment_report:${limit.name}:${memberId}`, limit.windowSeconds, limit.maxHits);
    if (!within) return { error: "You've sent a lot of reports. Try again in a little while." };
  }

  try {
    const outcome = await repos.courseComments.report({ commentId, reporterId: memberId, reason: cleaned.reason });
    if (outcome === "already_reported") return { error: "You've already reported this comment" };
    if (outcome === "not_found") return { error: NOT_AVAILABLE };
    // The author sees nothing of this: no notification, no change to the thread.
    return { id: commentId };
  } catch (error) {
    // The database's own message (never the reason) is enough to find it.
    console.error("lesson_comment_reports insert failed:", error instanceof Error ? error.message : error);
    return { error: "Couldn't send your report" };
  }
}

async function setLessonCommentFollowImpl(lessonId: string, following: boolean): Promise<CommentResult> {
  if (!isId(lessonId, "les") || typeof following !== "boolean") return { error: NOT_AVAILABLE };
  const caller = await getCoursesCaller();
  if (!caller) return { error: "Not available" };
  if (caller.identity.isSudo) return { error: "Read-only while previewing" };
  if (!(await commentsOn(caller))) return { error: NOT_AVAILABLE };

  const repos = createRepos(createServiceRoleClient());
  if (!(await lessonOpenForComments(repos, caller, lessonId))) return { error: NOT_AVAILABLE };
  try {
    await repos.courseComments.setFollowing(caller.identity.memberId, lessonId, following);
    return { id: lessonId };
  } catch (error) {
    console.error("lesson_comment_follows write failed:", error instanceof Error ? error.message : error);
    return { error: "Couldn't save that" };
  }
}

/**
 * People the writer can mention while typing `@name` under this lesson: members who can open its course (and staff, badged as
 * instructors), never the writer. A read: it needs the same gate as posting, and returns names only.
 */
export async function suggestCommentMentions(lessonId: string, typed: string): Promise<MentionChoice[]> {
  if (!isId(lessonId, "les") || typeof typed !== "string") return [];
  const caller = await getCoursesCaller();
  if (!caller || caller.identity.isSudo || !(await commentsOn(caller))) return [];
  const repos = createRepos(createServiceRoleClient());
  const open = await lessonOpenForComments(repos, caller, lessonId);
  if (!open) return [];
  return suggestMentionable(repos, open.courseId, caller.identity.memberId, typed);
}

// Usage analytics: each action records whether it worked (src/lib/analytics/server.ts).
export async function postLessonComment(...args: Parameters<typeof postLessonCommentImpl>): ReturnType<typeof postLessonCommentImpl> {
  return withAction("lesson_comment_posted", () => postLessonCommentImpl(...args));
}

export async function editLessonComment(...args: Parameters<typeof editLessonCommentImpl>): ReturnType<typeof editLessonCommentImpl> {
  return withAction("lesson_comment_edited", () => editLessonCommentImpl(...args));
}

export async function deleteLessonComment(...args: Parameters<typeof deleteLessonCommentImpl>): ReturnType<typeof deleteLessonCommentImpl> {
  return withAction("lesson_comment_deleted", () => deleteLessonCommentImpl(...args));
}

export async function reportLessonComment(...args: Parameters<typeof reportLessonCommentImpl>): ReturnType<typeof reportLessonCommentImpl> {
  return withAction("lesson_comment_reported", () => reportLessonCommentImpl(...args));
}

export async function setLessonCommentFollow(...args: Parameters<typeof setLessonCommentFollowImpl>): ReturnType<typeof setLessonCommentFollowImpl> {
  return withAction("lesson_follow_toggled", () => setLessonCommentFollowImpl(...args));
}
