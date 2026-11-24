import { linkifyText } from "@/lib/courses/comment-text";
import type { LessonCommentRecord, ThreadEntry } from "@/lib/data/course-comments";
import type { CoursesCaller } from "@/lib/courses/caller";
import { canOpenLessons, loadMemberCourseAccess } from "@/lib/courses/member";
import type { Repos } from "@/lib/data/repos";

/** Rules for lesson comments (docs/product/COURSES.md, "Lesson comments"). The server actions and the thread's composer share them. */

export const COMMENT_MAX_LENGTH = 4000;
/** A comment can be edited this long after it is posted. */
export const COMMENT_EDIT_WINDOW_MS = 15 * 60 * 1000;
/** Posting limits per member: a burst and a sustained rate. */
export const COMMENT_RATE_LIMITS = [
  { name: "minute", windowSeconds: 60, maxHits: 5 },
  { name: "hour", windowSeconds: 3600, maxHits: 30 },
] as const;

/**
 * The text as it will be stored: line endings made `\n`, surrounding whitespace removed. Nothing else is changed (no
 * escaping, no decoding), so a name with `&` or `<` stays as typed. Returns an error to show when it is empty or too long.
 */
export function cleanCommentBody(raw: unknown): { body: string } | { error: string } {
  if (typeof raw !== "string") return { error: "Write something first" };
  const body = raw.replace(/\r\n?/g, "\n").trim();
  if (body.length === 0) return { error: "Write something first" };
  if (body.length > COMMENT_MAX_LENGTH) return { error: `Keep it under ${COMMENT_MAX_LENGTH.toLocaleString("en-US")} characters` };
  return { body };
}

/** Reports per member: a burst and a sustained rate, so a report can't be used to flood staff. */
export const REPORT_RATE_LIMIT = [
  { name: "hour", windowSeconds: 3600, maxHits: 10 },
  { name: "day", windowSeconds: 86400, maxHits: 30 },
] as const;

/** A comment with more than this many links is held for staff review. */
export const COMMENT_MAX_LINKS = 2;
export const REPORT_REASON_MAX_LENGTH = 500;

/** How many `http(s)` links a text has, counted the way the thread auto-links them, so what is held is what would show as links. */
export function countCommentLinks(text: string): number {
  return linkifyText(text).filter((part) => part.type === "link").length;
}

/** Whether a comment goes to staff for review before others see it: more than two links. No word filter. */
export function shouldHoldComment(text: string): boolean {
  return countCommentLinks(text) > COMMENT_MAX_LINKS;
}

/** A report's reason as it will be stored: trimmed, 1 to 500 characters. Returns an error to show otherwise. */
export function cleanReportReason(raw: unknown): { reason: string } | { error: string } {
  if (typeof raw !== "string") return { error: "Tell us briefly what's wrong" };
  const reason = raw.replace(/\r\n?/g, "\n").trim();
  if (reason.length === 0) return { error: "Tell us briefly what's wrong" };
  if (reason.length > REPORT_REASON_MAX_LENGTH) return { error: `Keep it under ${REPORT_REASON_MAX_LENGTH} characters` };
  return { reason };
}

/** Whether the author can still change the text, `now` being a time in milliseconds. */
export function withinEditWindow(createdAt: string, now: number): boolean {
  return now - new Date(createdAt).getTime() <= COMMENT_EDIT_WINDOW_MS;
}

/** A comment someone can no longer act on: deleted, or hidden by staff. */
export const isRemovedComment = (comment: Pick<LessonCommentRecord, "deletedAt" | "hiddenAt">) => Boolean(comment.deletedAt || comment.hiddenAt);

type CommentRepos = Pick<Repos, "courses" | "courseProgress">;

export type CommentLesson = { lessonId: string; courseId: string };

/**
 * The lesson a comment is about, when this caller may open it: it exists and is open (a lesson that is coming soon or hidden
 * shows no comments, even to staff previewing it), and the course is open to them (current access, or staff acting as
 * themselves). Null otherwise; the caller gives the same "not available" answer for every reason.
 */
export async function lessonOpenForComments(repos: CommentRepos, caller: CoursesCaller, lessonId: string): Promise<CommentLesson | null> {
  const lesson = await repos.courses.lessonById(lessonId);
  if (!lesson || lesson.state !== "open") return null;
  const course = await repos.courses.courseById(lesson.course_id);
  if (!course || course.is_draft) return null;
  const access = await loadMemberCourseAccess(repos, caller.scope, lesson.course_id);
  if (!canOpenLessons(access)) return null;
  return { lessonId: lesson.id, courseId: lesson.course_id };
}

/**
 * How many comments in a thread are new to a member: live comments by others made after `since`, when they last opened it.
 * A first visit (`since` null) has no "new": the whole thread is new to them, which says nothing.
 */
export function countUnread(entries: ThreadEntry[], viewerId: string, since: string | null): number {
  if (!since) return 0;
  const after = Date.parse(since);
  let count = 0;
  for (const entry of entries) {
    for (const comment of [entry.comment, ...entry.replies]) {
      if (comment.removed || comment.held || comment.hidden || comment.memberId === viewerId) continue;
      if (Date.parse(comment.createdAt) > after) count += 1;
    }
  }
  return count;
}

/**
 * Whether an instructor is in this question: it was asked by staff, or a live instructor reply hangs under it. What the
 * thread's "Instructor answers" filter keeps. A removed or held reply doesn't count: members can't read it.
 */
export function involvesInstructor(entry: ThreadEntry): boolean {
  const live = (c: ThreadEntry["comment"]) => !c.removed && !c.held && !c.hidden && c.isStaffReply;
  return live(entry.comment) || entry.replies.some(live);
}

/** How many comments a member saw, in the buckets the analytics event allows. */
export function commentCountBucket(count: number): "0" | "1-5" | "6-20" | "21+" {
  if (count <= 0) return "0";
  if (count <= 5) return "1-5";
  if (count <= 20) return "6-20";
  return "21+";
}
