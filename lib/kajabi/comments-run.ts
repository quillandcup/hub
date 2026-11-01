/**
 * The `courses:content --comments` run, apart from the browser (docs/COURSES.md, "Lesson comments"): given the
 * lessons with their comment-page links and a way to read one lesson's page, it saves each lesson's comments to
 * `bronze.kajabi_lesson_comments` as a snapshot.
 *
 * Nothing here prints or returns a name, a body or an address: the summary is counts only. A lesson whose page
 * could not be read completely (failed, or cut off at the press limit) writes nothing, so it can never soft-delete
 * comments. Relative imports only: the script that calls this runs outside Next.
 */

import type { Db } from "../data/db";
import { SupabaseKajabiCourseRepository } from "../data/kajabi-courses";
import { parseComments, type KeySource, type PageComments, type ParsedComment, type PostLink } from "./comments-capture";
import { loadKnownLessonIds } from "./progress-run";

/** The Kajabi login is no longer valid: stop the run and log in again. */
export class CommentsSessionExpiredError extends Error {}

export interface CommentsSave {
  written: number;
  unchanged: number;
  removed: number;
}

const sameInstant = (a: string | null, b: string | null) => (a === null || b === null ? a === b : new Date(a).getTime() === new Date(b).getTime());

/**
 * Replaces one lesson's comments with a fully read snapshot: new and changed comments are upserted, comments the
 * snapshot no longer lists are soft-deleted (only with `removeMissing`), an identical snapshot writes nothing.
 * Only this lesson is touched. `dryRun` counts without writing.
 */
export async function saveLessonComments(
  db: Db,
  input: { courseKajabiId: string; lessonKajabiId: string; comments: ParsedComment[]; capturedAt: Date },
  options: { dryRun?: boolean; removeMissing?: boolean } = {},
): Promise<CommentsSave> {
  const { courseKajabiId, lessonKajabiId, comments, capturedAt } = input;
  const repo = new SupabaseKajabiCourseRepository(db);
  const stored = new Map((await repo.lessonComments(lessonKajabiId)).map((s) => [s.comment_key, s]));
  const toWrite = comments.filter((c) => {
    const s = stored.get(c.commentKey);
    return (
      !s ||
      s.deleted_at !== null ||
      s.course_kajabi_id !== courseKajabiId ||
      s.parent_comment_key !== c.parentCommentKey ||
      s.author_name !== c.authorName ||
      s.body !== c.body ||
      !sameInstant(s.posted_at, c.postedAt)
    );
  });
  const listed = new Set(comments.map((c) => c.commentKey));
  const gone = options.removeMissing === false ? [] : [...stored.values()].filter((s) => s.deleted_at === null && !listed.has(s.comment_key)).map((s) => s.comment_key);

  if (!options.dryRun) {
    await repo.upsertLessonComments(
      toWrite.map((c) => ({
        course_kajabi_id: courseKajabiId,
        lesson_kajabi_id: lessonKajabiId,
        comment_key: c.commentKey,
        parent_comment_key: c.parentCommentKey,
        author_name: c.authorName,
        posted_at: c.postedAt,
        body: c.body,
        captured_at: capturedAt.toISOString(),
        deleted_at: null,
      })),
    );
    await repo.softDeleteLessonComments(lessonKajabiId, gone, capturedAt.toISOString());
  }
  return { written: toWrite.length, unchanged: comments.length - toWrite.length, removed: gone.length };
}

/**
 * What reading one lesson's page gave. `noList`: the page loaded but has no comments list. With `hasCommentBox` the
 * page does have the box to write a comment (so the lesson has none); without it the page may not be a lesson page
 * at all (a redirect, comments off, a page that did not finish rendering), which is worth a look. `locked`: the page
 * says the post is locked (a course that makes members finish one lesson before the next opens): the preview opens as
 * a member with no progress, so such a lesson shows no comments, and its comments cannot be read from it.
 */
export type LessonRead =
  | { kind: "ok"; page: PageComments; capped: boolean }
  | { kind: "noList"; hasCommentBox: boolean; locked?: boolean };

export interface CommentsRunOptions {
  db: Db;
  courseKajabiId: string;
  lessons: PostLink[];
  /** Opens the lesson's page, presses Show More until it is gone, reads the comments. Throws CommentsSessionExpiredError on a login redirect. */
  readLesson: (lesson: PostLink) => Promise<LessonRead>;
  apply: boolean;
  timeZone: string;
  concurrency?: number;
  delayMs?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => Date;
  log?: (line: string) => void;
}

export interface CommentsSummary {
  lessonsListed: number;
  /** Lessons in the admin list that Bronze (step A) has no lesson for: not opened. */
  lessonsNotInBronze: number;
  lessonsCaptured: number;
  lessonsWithComments: number;
  /** Comments and replies captured. */
  comments: number;
  replies: number;
  rows: CommentsSave;
  keySources: Record<KeySource, number>;
  duplicateKeys: number;
  /** Lessons whose page loaded with a comment box but no comments: none to capture (nothing written for them). */
  lessonsNoComments: number;
  /** Lessons whose page says the post is locked until an earlier lesson is completed: their comments cannot be read from this preview (nothing written for them). */
  lessonsLocked: number;
  /** Lessons whose page has neither a comments list, a comment box nor a lock notice: not read, worth a look (nothing written for them). */
  lessonsWithoutList: number;
  /** Lessons cut off at the Show More limit (nothing written for them). */
  lessonsCapped: number;
  /** Lessons where the page's own total differs from what was read (written, but nothing removed when fewer were read). */
  lessonsMismatched: number;
  lessonsFailed: number;
}

export async function runCommentsCapture(options: CommentsRunOptions): Promise<CommentsSummary> {
  const { db, courseKajabiId, apply, timeZone } = options;
  const log = options.log ?? (() => undefined);
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const now = options.now ?? (() => new Date());
  const delayMs = options.delayMs ?? 500;

  const known = await loadKnownLessonIds(db, courseKajabiId);
  const lessons = options.lessons.filter((l) => known.has(l.lessonKajabiId));
  const summary: CommentsSummary = {
    lessonsListed: options.lessons.length,
    lessonsNotInBronze: options.lessons.length - lessons.length,
    lessonsCaptured: 0,
    lessonsWithComments: 0,
    comments: 0,
    replies: 0,
    rows: { written: 0, unchanged: 0, removed: 0 },
    keySources: { "reply-link": 0, "reply-container": 0, "data-comment": 0, hash: 0 },
    duplicateKeys: 0,
    lessonsNoComments: 0,
    lessonsLocked: 0,
    lessonsWithoutList: 0,
    lessonsCapped: 0,
    lessonsMismatched: 0,
    lessonsFailed: 0,
  };
  const failureKinds = new Map<string, number>();

  async function read(lesson: PostLink): Promise<{ ok: true; read: LessonRead } | { ok: false; reason: string }> {
    let reason = "";
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        return { ok: true, read: await options.readLesson(lesson) };
      } catch (error) {
        if (error instanceof CommentsSessionExpiredError) throw error;
        reason = error instanceof Error ? error.message : "unknown error";
        await sleep(delayMs * 2);
      }
    }
    return { ok: false, reason };
  }

  const queue = [...lessons];
  let done = 0;
  let stopped = false;
  const worker = async () => {
    for (let lesson = queue.shift(); lesson && !stopped; lesson = queue.shift()) {
      let result: Awaited<ReturnType<typeof read>>;
      try {
        result = await read(lesson);
      } catch (error) {
        stopped = true;
        throw error;
      }
      if (!result.ok) {
        summary.lessonsFailed++;
        failureKinds.set(result.reason, (failureKinds.get(result.reason) ?? 0) + 1);
      } else if (result.read.kind === "noList") {
        if (result.read.locked) summary.lessonsLocked++;
        else if (result.read.hasCommentBox) summary.lessonsNoComments++;
        else summary.lessonsWithoutList++;
      } else if (result.read.capped) {
        summary.lessonsCapped++;
        log(`lesson ${lesson.lessonKajabiId}: stopped at the Show More limit, nothing written for it`);
      } else {
        const { page } = result.read;
        const parsed = parseComments(page.comments, lesson.lessonKajabiId, timeZone);
        const short = page.total !== null && parsed.comments.length < page.total;
        if (page.total !== null && page.total !== parsed.comments.length) {
          summary.lessonsMismatched++;
          log(`lesson ${lesson.lessonKajabiId}: the page says ${page.total} comments, read ${parsed.comments.length}`);
        }
        try {
          const saved = await saveLessonComments(
            db,
            { courseKajabiId, lessonKajabiId: lesson.lessonKajabiId, comments: parsed.comments, capturedAt: now() },
            { dryRun: !apply, removeMissing: !short },
          );
          summary.lessonsCaptured++;
          if (parsed.comments.length > 0) summary.lessonsWithComments++;
          summary.comments += parsed.comments.length;
          summary.replies += parsed.comments.filter((c) => c.parentCommentKey !== null).length;
          summary.rows.written += saved.written;
          summary.rows.unchanged += saved.unchanged;
          summary.rows.removed += saved.removed;
          summary.duplicateKeys += parsed.duplicateKeys;
          for (const k of Object.keys(parsed.keySources) as KeySource[]) summary.keySources[k] += parsed.keySources[k];
        } catch (error) {
          summary.lessonsFailed++;
          const reason = `saving failed (${error instanceof Error ? error.message : "unknown error"})`;
          failureKinds.set(reason, (failureKinds.get(reason) ?? 0) + 1);
        }
      }
      done++;
      if (done % 10 === 0) log(`${done} of ${lessons.length} lessons`);
      await sleep(delayMs);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(options.concurrency ?? 2, lessons.length || 1)) }, worker));
  for (const [reason, count] of failureKinds) log(`${count} lesson(s) failed: ${reason}`);
  return summary;
}
