/**
 * The `courses:content --comments` run, apart from the browser (docs/product/COURSES.md, "Lesson comments"): given the
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
  /** Stored comments the snapshot does not list (removed, or held back when `removeMissing` is false). */
  missing: number;
}

const sameInstant = (a: string | null, b: string | null) => (a === null || b === null ? a === b : new Date(a).getTime() === new Date(b).getTime());

/**
 * Replaces one lesson's comments with a fully read snapshot: new and changed comments are upserted, comments the
 * snapshot no longer lists are soft-deleted (only with `removeMissing`), an identical snapshot writes nothing.
 * Only this lesson is touched. `dryRun` counts without writing. A snapshot that is not known to be complete must pass
 * `removeMissing: false`: it then only adds and updates, so a partial read can never mark a good comment deleted.
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
  const missing = [...stored.values()].filter((s) => s.deleted_at === null && !listed.has(s.comment_key)).length;
  return { written: toWrite.length, unchanged: comments.length - toWrite.length, removed: gone.length, missing };
}

/**
 * What reading one lesson's page gave. `noList`: the page loaded but has no comments list. With `hasCommentBox` the
 * page does have the box to write a comment (so the lesson has none); without it the page may not be a lesson page
 * at all (a redirect, comments off, a page that did not finish rendering), which is worth a look. `locked`: the page
 * says the post is locked (a course that makes members finish one lesson before the next opens): the preview opens as
 * a member with no progress, so such a lesson shows no comments, and its comments cannot be read from it. `quiz`: the
 * page is a quiz or assessment (radio-button questions), which has no comments by design.
 */
export type LessonRead =
  | { kind: "ok"; page: PageComments; capped: boolean; /** How many "Show More" and similar controls were pressed. */ presses?: number }
  | { kind: "noList"; hasCommentBox: boolean; locked?: boolean; quiz?: boolean; /** The total the page prints next to its Comments heading, when the page has one. */ declaredTotal?: number | null; iframes?: number };

/** What the run saw on one lesson, for the owner to compare with Kajabi. Counts only. */
export interface LessonReport {
  lessonKajabiId: string;
  comments: number;
  replies: number;
  presses: number;
  /** The total the page printed, when it did. */
  declaredTotal: number | null;
  warnings: string[];
}

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
  rows: Omit<CommentsSave, "missing">;
  keySources: Record<KeySource, number>;
  duplicateKeys: number;
  /** Lessons whose page loaded with a comment box but no comments: none to capture (nothing written for them). */
  lessonsNoComments: number;
  /** Lessons that are a quiz or assessment: no comments by design (nothing written for them). */
  lessonsQuizzes: number;
  /** Lessons whose page says the post is locked until an earlier lesson is completed: their comments cannot be read from this preview (nothing written for them). */
  lessonsLocked: number;
  /** Lessons whose page has neither a comments list, a comment box nor a lock notice: not read, worth a look (nothing written for them). */
  lessonsWithoutList: number;
  /** Lessons cut off at the Show More limit (nothing written for them). */
  lessonsCapped: number;
  /** Lessons where the page's own total differs from what was read (written, but nothing removed when fewer were read). */
  lessonsMismatched: number;
  lessonsFailed: number;
  /** Times "Show More" (or a control like it) was pressed, over all lessons. */
  presses: number;
  /** Lessons whose comments list was on the page but held no comment, or the page prints a total above zero for a lesson with no list (a read that probably missed them). */
  lessonsEmptyList: number;
  /** Lessons still showing a control that would reveal more at the end of the read (nothing removed for them). */
  lessonsPendingControls: number;
  /** Lessons with no comments read and a frame on the page: comments inside a frame cannot be read. */
  lessonsWithFrames: number;
  /** Stored comments a lesson's read did not list and that were NOT marked removed, because the read was not shown to be complete. */
  removalsHeld: number;
  /** Per lesson: what was seen, in the order the lessons finished. */
  lessonReports: LessonReport[];
  /** Lines to read first: anything that suggests comments were missed. */
  warnings: string[];
}

export async function runCommentsCapture(options: CommentsRunOptions): Promise<CommentsSummary> {
  const { db, courseKajabiId, apply, timeZone } = options;
  const log = options.log ?? (() => undefined);
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const now = options.now ?? (() => new Date());
  const delayMs = options.delayMs ?? 500;

  const known = await loadKnownLessonIds(db, courseKajabiId);
  // A lesson Bronze already holds a quiz for is a quiz whatever its page looks like: a quiz has no comment thread in Kajabi.
  const quizLessons = new Set((await new SupabaseKajabiCourseRepository(db).liveQuizzes(courseKajabiId)).map((q) => q.lesson_kajabi_id));
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
    lessonsQuizzes: 0,
    lessonsLocked: 0,
    lessonsWithoutList: 0,
    lessonsCapped: 0,
    lessonsMismatched: 0,
    lessonsFailed: 0,
    presses: 0,
    lessonsEmptyList: 0,
    lessonsPendingControls: 0,
    lessonsWithFrames: 0,
    removalsHeld: 0,
    lessonReports: [],
    warnings: [],
  };
  const warn = (line: string) => {
    summary.warnings.push(line);
    log(`WARNING: ${line}`);
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
        const declared = result.read.declaredTotal ?? null;
        if (quizLessons.has(lesson.lessonKajabiId) || result.read.quiz) summary.lessonsQuizzes++;
        else if (result.read.locked) summary.lessonsLocked++;
        else if (result.read.hasCommentBox) {
          summary.lessonsNoComments++;
          // The page prints a count above zero (or has a frame that could hold comments) yet nothing was read: this "no comments" is not to be trusted.
          if (declared !== null && declared > 0) {
            summary.lessonsEmptyList++;
            warn(`lesson ${lesson.lessonKajabiId}: the page says ${declared} comments but no comments list was read`);
          } else if ((result.read.iframes ?? 0) > 0) {
            summary.lessonsWithFrames++;
            warn(`lesson ${lesson.lessonKajabiId}: no comments read, and the page has ${result.read.iframes} frame(s) that could hold them`);
          }
          summary.lessonReports.push({ lessonKajabiId: lesson.lessonKajabiId, comments: 0, replies: 0, presses: 0, declaredTotal: declared, warnings: [] });
        } else {
          summary.lessonsWithoutList++;
          // Its id is a Kajabi lesson id, not personal data: say which, so it can be opened and looked at.
          log(`lesson ${lesson.lessonKajabiId}: no comments list, no comment box and no lock notice (open it in the preview to see why)`);
        }
      } else if (result.read.capped) {
        summary.lessonsCapped++;
        warn(`lesson ${lesson.lessonKajabiId}: stopped at the Show More limit, nothing written for it`);
      } else {
        const { page } = result.read;
        const presses = result.read.presses ?? 0;
        const parsed = parseComments(page.comments, lesson.lessonKajabiId, timeZone);
        const replyCount = parsed.comments.filter((c) => c.parentCommentKey !== null).length;
        const lessonWarnings: string[] = [];
        const flag = (text: string) => {
          lessonWarnings.push(text);
          warn(`lesson ${lesson.lessonKajabiId}: ${text}`);
        };
        if (page.total !== null && page.total !== parsed.comments.length) {
          summary.lessonsMismatched++;
          flag(`the page says ${page.total} comments, read ${parsed.comments.length}`);
        }
        if (parsed.comments.length === 0) {
          summary.lessonsEmptyList++;
          flag("the comments list is on the page but no comment was read from it");
          if (page.iframes > 0) {
            summary.lessonsWithFrames++;
            flag(`the page has ${page.iframes} frame(s) that could hold the comments`);
          }
        }
        if (page.pendingControls > 0) {
          summary.lessonsPendingControls++;
          flag(`${page.pendingControls} control(s) that would show more comments or replies were still on the page at the end`);
        }
        // A removal is only trusted when something was read, the page's own total says everything was read and nothing is left to open. A page with no total cannot say so.
        const complete = page.total !== null && parsed.comments.length > 0 && parsed.comments.length >= page.total && page.pendingControls === 0;
        try {
          const saved = await saveLessonComments(
            db,
            { courseKajabiId, lessonKajabiId: lesson.lessonKajabiId, comments: parsed.comments, capturedAt: now() },
            { dryRun: !apply, removeMissing: complete },
          );
          if (!complete && saved.missing > 0) {
            summary.removalsHeld += saved.missing;
            flag(`${saved.missing} stored comment(s) were not seen again and were NOT marked removed (the read is not shown to be complete)`);
          }
          summary.presses += presses;
          summary.lessonReports.push({
            lessonKajabiId: lesson.lessonKajabiId,
            comments: parsed.comments.length,
            replies: replyCount,
            presses,
            declaredTotal: page.total,
            warnings: lessonWarnings,
          });
          log(`lesson ${lesson.lessonKajabiId}: ${parsed.comments.length} comments (${replyCount} replies), ${presses} controls pressed${page.total !== null ? `, page total ${page.total}` : ""}`);
          summary.lessonsCaptured++;
          if (parsed.comments.length > 0) summary.lessonsWithComments++;
          summary.comments += parsed.comments.length;
          summary.replies += replyCount;
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
  for (const [reason, count] of failureKinds) {
    summary.warnings.push(`${count} lesson(s) failed: ${reason}`);
    log(`${count} lesson(s) failed: ${reason}`);
  }
  return summary;
}
