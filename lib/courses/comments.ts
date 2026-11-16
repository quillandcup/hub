import type { LessonCommentRecord } from "@/lib/data/course-comments";
import type { CoursesCaller } from "@/lib/courses/caller";
import { canOpenLessons, loadMemberCourseAccess } from "@/lib/courses/member";
import type { Repos } from "@/lib/data/repos";

/** Rules for lesson comments (docs/COURSES.md, "Lesson comments"). The server actions and the thread's composer share them. */

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

/** How many comments a member saw, in the buckets the analytics event allows. */
export function commentCountBucket(count: number): "0" | "1-5" | "6-20" | "21+" {
  if (count <= 0) return "0";
  if (count <= 5) return "1-5";
  if (count <= 20) return "6-20";
  return "21+";
}
