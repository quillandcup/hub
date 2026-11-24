import type { ImportableLessonComment } from "@/lib/data/kajabi-courses";
import type { ImportedCommentRecord, ImportedCommentWrite } from "@/lib/data/course-comments";
import type { Repos } from "@/lib/data/repos";
import { COMMENT_MAX_LENGTH } from "@/lib/courses/comments";

type CommentsImportRepos = Pick<Repos, "courses" | "kajabiCourses" | "courseComments">;

/** The `lesson_comments.source` of a comment that came from Kajabi. */
export const KAJABI_COMMENT_SOURCE = "kajabi";
const AUTHOR_MAX_LENGTH = 200;
/** What an author is called when the capture found no usable name. */
const NO_NAME = "Former member";

/**
 * Bronze (bronze.kajabi_lesson_comments) -> Silver `lesson_comments` (docs/product/COURSES.md, "Importing Kajabi lesson
 * comments"). The Bronze rows are a capture of the member lesson pages, so the source is the capture, not a webhook, and
 * there is no pull-based twin: the capture is the pull (`courses:content --comments`).
 *
 * One Hub comment per Bronze comment, keyed `source = 'kajabi'`, `source_key = "<lesson id>/<comment key>"` (unique), so running
 * it again never duplicates. The import owns what Kajabi said (author name, text, time, thread position, whether it was
 * removed there) and nothing else: a staff hide, a report, a handled mark or a staff delete is never undone. It:
 *  - shows the author by the name on the comment, with no member behind it: Kajabi's page has no email or id to match on, and
 *    members are never matched by name (`member_id` is null);
 *  - keeps Kajabi's own time as `created_at`, and threads a reply under its comment (a reply to a reply goes under the
 *    comment above it; a reply whose comment is not in Bronze becomes a top-level comment and is counted);
 *  - creates no follow, no notification and no report, is never held, and (being old, source-marked) never counts as new or as an
 *    unanswered question;
 *  - soft deletes (`deleted_at`, no `deleted_by`) a comment Bronze has since marked removed, and restores one it lists again,
 *    unless a person deleted it in the Hub.
 */

export interface CourseCommentsImport {
  slug: string;
  /** Comments in Bronze for the course's lessons (removed ones included). */
  commentsInBronze: number;
  /** Comments whose Kajabi lesson has no Hub lesson (removed in Kajabi, or not synced yet): not imported. */
  unmatchedLessonComments: number;
  /** Different author names on the comments to import. None is linked to a member: Kajabi's page carries no email or id. */
  authorsWithoutMember: number;
  /** Replies among the comments to import. */
  replies: number;
  /** Replies whose comment is not in Bronze (or is not importable): imported as top-level comments. */
  orphanReplies: number;
  /** Comments with no text left after cleaning, or removed in Kajabi before the Hub ever had them: skipped. */
  skipped: number;
  /** Comments shortened to the Hub's length limit. */
  truncated: number;
  /** Rows written (or, in a dry run, that would be). */
  inserted: number;
  updated: number;
  /** Already the same in the Hub. */
  unchanged: number;
  /** Of the written rows: soft deleted because Kajabi no longer lists them, and brought back because it lists them again. */
  removed: number;
  restored: number;
}

export interface CommentsImportResult {
  dryRun: boolean;
  courses: CourseCommentsImport[];
}

export class CommentsImportError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

const NAMED_ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

/**
 * A captured comment as the Hub stores it: plain text. The capture already reads text, but a body that carries markup
 * (older captures, a pasted snippet) is reduced here: line breaks and paragraph ends become newlines, tags and their
 * attributes are dropped, the common entities are decoded, then line endings are normalized, runs of blank lines collapsed and
 * the ends trimmed. Text that merely contains `<` (as in "a < b") is left alone, since only tag-shaped text is a tag.
 */
export function plainCommentText(raw: string): string {
  const text = raw
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|blockquote|h[1-6])\s*>/gi, "\n")
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, "")
    .replace(/<\/?[a-zA-Z][^>]*>/g, "")
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, entity: string) => {
      if (entity[0] === "#") {
        const code = entity[1].toLowerCase() === "x" ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
        return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
      }
      return NAMED_ENTITIES[entity.toLowerCase()] ?? whole;
    });
  return text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t ]+$/g, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** The author's name as shown: one line, markup dropped, never an email (an address is replaced), at most 200 characters. */
export function cleanImportedAuthor(raw: string | null | undefined): string {
  const name = plainCommentText(raw ?? "").replace(/\s+/g, " ").trim();
  if (!name || /\S+@\S+\.\S+/.test(name)) return NO_NAME;
  return name.slice(0, AUTHOR_MAX_LENGTH);
}

const sourceKeyOf = (lessonKajabiId: string, commentKey: string) => `${lessonKajabiId}/${commentKey}`;

/** What Kajabi says about one comment, ready to compare with the Hub's row. */
interface Wanted {
  sourceKey: string;
  lessonId: string;
  /** The source key of the comment above it, or null for a top-level comment. */
  parentKey: string | null;
  authorName: string;
  body: string;
  createdAt: string;
  /** Kajabi no longer lists it. */
  removedInKajabi: boolean;
  removedAt: string | null;
}

export async function importKajabiLessonComments(
  repos: CommentsImportRepos,
  options: { courseSlug?: string; dryRun?: boolean } = {},
): Promise<CommentsImportResult> {
  const dryRun = options.dryRun ?? false;
  const only = options.courseSlug ? await repos.courses.courseBySlug(options.courseSlug, { source: "kajabi" }) : null;
  const courses = options.courseSlug ? (only ? [only] : []) : await repos.courses.courses({ source: "kajabi" });
  if (options.courseSlug && courses.length === 0) throw new CommentsImportError(`No Kajabi course has the slug "${options.courseSlug}"`, 404);

  const result: CommentsImportResult = { dryRun, courses: [] };
  for (const course of courses) {
    const summary: CourseCommentsImport = {
      slug: course.slug,
      commentsInBronze: 0,
      unmatchedLessonComments: 0,
      authorsWithoutMember: 0,
      replies: 0,
      orphanReplies: 0,
      skipped: 0,
      truncated: 0,
      inserted: 0,
      updated: 0,
      unchanged: 0,
      removed: 0,
      restored: 0,
    };
    result.courses.push(summary);
    if (!course.source_key) continue;

    const [bronze, lessons] = await Promise.all([
      repos.kajabiCourses.commentsOfCourse(course.source_key),
      repos.courses.lessonsOf([course.id], { source: "kajabi", includeHidden: true }),
    ]);
    const lessonIdByKey = new Map<string, string>(lessons.flatMap((l) => (l.source_key ? [[l.source_key, l.id] as [string, string]] : [])));
    summary.commentsInBronze = bronze.length;
    if (bronze.length === 0) continue;

    const existing = new Map<string, ImportedCommentRecord>(
      (await repos.courseComments.importedOf(KAJABI_COMMENT_SOURCE, [...lessonIdByKey.values()])).map((e) => [e.sourceKey, e]),
    );
    const wanted = wantedComments(bronze, lessonIdByKey, existing, summary);
    summary.authorsWithoutMember = new Set(wanted.map((w) => w.authorName)).size;

    const idOf = new Map<string, string>([...existing.values()].map((e) => [e.sourceKey, e.id]));
    // Top-level comments first, so a reply finds its comment's id; the second round is the replies.
    for (const replyRound of [false, true]) {
      const writes: ImportedCommentWrite[] = [];
      for (const w of wanted.filter((x) => (x.parentKey !== null) === replyRound)) {
        const row = existing.get(w.sourceKey);
        const parentId = w.parentKey ? (idOf.get(w.parentKey) ?? null) : null;
        // Kajabi's removal is the import's to apply or undo; a person's delete in the Hub is not.
        const deletedAt = row?.deletedBy ? row.deletedAt : w.removedInKajabi ? (row?.deletedAt ?? w.removedAt) : null;
        const desired: ImportedCommentWrite = { lessonId: w.lessonId, sourceKey: w.sourceKey, parentId, authorName: w.authorName, body: w.body, createdAt: w.createdAt, deletedAt };
        if (!row) {
          writes.push(desired);
          summary.inserted++;
          continue;
        }
        const same =
          row.authorName === desired.authorName &&
          row.body === desired.body &&
          Date.parse(row.createdAt) === Date.parse(desired.createdAt) &&
          row.deletedAt === desired.deletedAt &&
          row.parentId === desired.parentId &&
          row.lessonId === desired.lessonId;
        if (same) {
          summary.unchanged++;
          continue;
        }
        writes.push(desired);
        summary.updated++;
        if (!row.deletedAt && deletedAt) summary.removed++;
        if (row.deletedAt && !deletedAt) summary.restored++;
      }
      if (!dryRun && writes.length > 0) {
        for (const written of await repos.courseComments.upsertImported(KAJABI_COMMENT_SOURCE, writes)) idOf.set(written.sourceKey, written.id);
      }
    }
  }
  return result;
}

/**
 * The Bronze comments of the lessons the Hub has, as what each Hub comment should be. Fills the summary's counts of what is
 * left out or reshaped on the way (lessons not in the Hub, empty text, removed ones the Hub never had, replies without their
 * comment, shortened text).
 */
function wantedComments(
  bronze: ImportableLessonComment[],
  lessonIdByKey: Map<string, string>,
  existing: Map<string, ImportedCommentRecord>,
  summary: CourseCommentsImport,
): Wanted[] {
  const byKey = new Map<string, ImportableLessonComment>(bronze.map((c) => [sourceKeyOf(c.lesson_kajabi_id, c.comment_key), c]));
  const wanted = new Map<string, Wanted>();
  for (const c of bronze) {
    const lessonId = lessonIdByKey.get(c.lesson_kajabi_id);
    if (!lessonId) {
      summary.unmatchedLessonComments++;
      continue;
    }
    const sourceKey = sourceKeyOf(c.lesson_kajabi_id, c.comment_key);
    // Words Kajabi has since removed are not imported if the Hub never had them.
    if (c.deleted_at !== null && !existing.has(sourceKey)) {
      summary.skipped++;
      continue;
    }
    let body = plainCommentText(c.body);
    if (!body) {
      summary.skipped++;
      continue;
    }
    if (body.length > COMMENT_MAX_LENGTH) {
      body = `${body.slice(0, COMMENT_MAX_LENGTH - 1).trimEnd()}…`;
      summary.truncated++;
    }
    wanted.set(sourceKey, {
      sourceKey,
      lessonId,
      parentKey: null,
      authorName: cleanImportedAuthor(c.author_name),
      body,
      createdAt: new Date(c.posted_at ?? c.captured_at).toISOString(),
      removedInKajabi: c.deleted_at !== null,
      removedAt: c.deleted_at ? new Date(c.deleted_at).toISOString() : null,
    });
  }

  // One level of replies: a reply's comment is found by walking up to the top-level comment (a reply to a reply goes under the
  // one above it). A comment missing from what is importable makes the reply a top-level comment.
  for (const w of wanted.values()) {
    const bronzeRow = byKey.get(w.sourceKey);
    if (!bronzeRow?.parent_comment_key) continue;
    summary.replies++;
    let parentKey = sourceKeyOf(bronzeRow.lesson_kajabi_id, bronzeRow.parent_comment_key);
    const seen = new Set<string>([w.sourceKey]);
    for (;;) {
      const above = byKey.get(parentKey)?.parent_comment_key;
      if (!above || seen.has(parentKey)) break;
      seen.add(parentKey);
      parentKey = sourceKeyOf(bronzeRow.lesson_kajabi_id, above);
    }
    const parent = wanted.get(parentKey);
    // A comment removed in Kajabi that was never imported is skipped, so it can't hold a reply.
    if (parent && parentKey !== w.sourceKey) w.parentKey = parentKey;
    else summary.orphanReplies++;
  }
  return [...wanted.values()];
}
