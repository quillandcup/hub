import { fetchAllRows } from "@/lib/supabase/paginate";
import { getMemberDisplayName } from "@/lib/member-display-name";
import type { Db } from "./db";
import type { InMemoryDataset } from "./in-memory";
import { compareText, inChunks, must } from "./query";

/**
 * Lesson comments (`lesson_comments`, docs/product/COURSES.md "Lesson comments"): questions and answers on a course lesson, plain
 * text, one level of replies. Reads and writes here are as the client's role says: the member pages use the service role
 * scoped to the effective member (the actions decide who may post), and row-level security is the second layer for a
 * signed-in client. Text is stored as typed and never decoded or escaped here. Throws on a database error.
 */

/** A comment as stored. */
export interface LessonCommentRecord {
  id: string;
  lessonId: string;
  /** The author; null only for an imported comment whose author has no Hub member (see `authorName`). */
  memberId: string | null;
  parentId: string | null;
  body: string;
  isStaffReply: boolean;
  createdAt: string;
  editedAt: string | null;
  hiddenAt: string | null;
  deletedAt: string | null;
  /** Held for staff review (too many links) until approved. */
  heldAt: string | null;
  /** Staff marked this question as needing no answer. */
  handledAt: string | null;
  /** Where an imported comment came from (`kajabi`); null for one written in the Hub. */
  source: string | null;
  /** The name an imported comment shows when it has no member; null for one written in the Hub. */
  authorName: string | null;
}

/** A comment as shown in a thread: the author by display name, and the text only while it is there to read. */
export interface ThreadComment {
  id: string;
  lessonId: string;
  memberId: string;
  parentId: string | null;
  authorName: string;
  isStaffReply: boolean;
  createdAt: string;
  editedAt: string | null;
  /** True for a deleted or hidden comment kept in the thread because it has replies: no text, no author, no badge. */
  removed: boolean;
  /** The text, or null when `removed`. */
  body: string | null;
  /** Staff only: hidden from members, shown to staff with its text. */
  hidden: boolean;
  /** Held for staff review: shown only to its author (with a note) and to staff. */
  held: boolean;
  /** Imported from another site (Kajabi): it has no member behind it (`memberId` is empty), and is never counted as new. */
  imported?: boolean;
}

/** Who is reading a thread: decides whether a hidden or held comment shows, and its text. */
export interface ThreadViewer {
  memberId: string;
  /** Staff acting as themselves (an admin, not one previewing as a member). */
  isStaff: boolean;
}

/** One top-level comment with its replies (oldest first). */
export interface ThreadEntry {
  comment: ThreadComment;
  replies: ThreadComment[];
}

export interface LessonThread {
  /** Top-level comments, newest first. A removed one is present only when a live reply hangs under it. */
  entries: ThreadEntry[];
  /** Live comments and replies (removed ones are not counted). */
  count: number;
}

/** A question nobody on staff has answered yet, for the admin list. */
export interface UnansweredQuestion {
  id: string;
  lessonId: string;
  lessonTitle: string;
  authorName: string;
  createdAt: string;
  /** The text, for staff reading the list. */
  body: string;
}

/** A comment staff are asked to look at: reported, with how many times and why. Reporters are never named. */
export interface ReportedComment {
  commentId: string;
  lessonId: string;
  lessonTitle: string;
  authorName: string;
  body: string;
  isReply: boolean;
  /** `visible` or `held` (a hidden or deleted comment has its reports settled). */
  state: "visible" | "held";
  reportCount: number;
  reasons: string[];
  /** When the oldest open report came in. */
  firstReportedAt: string;
}

/** A comment held for review because it had more than two links. */
export interface HeldComment {
  id: string;
  lessonId: string;
  lessonTitle: string;
  authorName: string;
  body: string;
  isReply: boolean;
  createdAt: string;
}

/** A live comment (not deleted, hidden or held) as the notification senders read it: who, where, when, never the text. */
export interface CommentActivity {
  id: string;
  lessonId: string;
  memberId: string;
  parentId: string | null;
  isStaffReply: boolean;
  createdAt: string;
}

/** A lesson with its course, for a notification's wording and link. */
export interface LessonInfo {
  lessonId: string;
  title: string;
  courseId: string;
  courseTitle: string;
  courseSlug: string;
}

/** What a lesson's thread looks like from the course outline: how many comments, how many questions wait, how many are new to the viewer. */
export interface LessonCommentCounts {
  /** Live comments and replies (removed and held ones are not counted). */
  total: number;
  /** Live questions nobody on staff has answered or marked handled. */
  unanswered: number;
  /** Live comments by others since the viewer last opened the thread; 0 when they never have. */
  newCount: number;
}

/** What waits for staff in one course: comments with open reports and comments held for review. */
export interface ModerationBacklogItem {
  courseId: string;
  courseTitle: string;
  reported: number;
  held: number;
}

export type ModerationAction = "hide" | "unhide" | "delete" | "approve" | "handle" | "dismiss";
/** `no_change` is an action that was already so: nothing was written. */
export type ModerationOutcome = "done" | "no_change" | "not_found";
export type ReportOutcome = "reported" | "already_reported" | "not_found";

export interface NewLessonComment {
  lessonId: string;
  memberId: string;
  /** A top-level comment's id; null for a new question. */
  parentId: string | null;
  body: string;
  isStaffReply: boolean;
  /** Held for staff review from the start (more than two links): its author and staff see it until approved. */
  held?: boolean;
}

export interface CourseCommentRepository {
  /** Adds a comment. Throws when the parent is not a top-level comment on the same lesson (the database refuses it). */
  create(comment: NewLessonComment): Promise<LessonCommentRecord>;
  /** One comment as stored (deleted and hidden ones too), or null when there is none. */
  byId(id: string): Promise<LessonCommentRecord | null>;
  /** Replaces the text and stamps `edited_at` with `editedAt`; null when the comment is not there. The caller checks the edit window. */
  edit(id: string, body: string, editedAt: string): Promise<LessonCommentRecord | null>;
  /** Soft deletes a comment (idempotent: an already deleted one keeps its first time). False when it is not there. */
  softDelete(id: string, deletedBy: string, deletedAt: string): Promise<boolean>;
  /**
   * A lesson's comments as a thread for this viewer (newest question first, replies oldest first): a hidden comment is a
   * tombstone to members and text to staff; a held one shows only to its author and staff. Reads every row past 1000.
   */
  threadFor(lessonId: string, viewer: ThreadViewer): Promise<LessonThread>;
  /** The live, released, unhandled top-level comments of a course's lessons with no live staff reply, oldest first. */
  unansweredQuestions(courseId: string): Promise<UnansweredQuestion[]>;
  /** Records a member's report. The same reporter reporting the same comment while it is open is `already_reported`. */
  report(input: { commentId: string; reporterId: string; reason: string }): Promise<ReportOutcome>;
  /** Comments with open reports across a course's lessons, the most reported first. Reads past 1000. */
  openReports(courseId: string): Promise<ReportedComment[]>;
  /** Comments held for review across a course's lessons, oldest first. Reads past 1000. */
  heldComments(courseId: string): Promise<HeldComment[]>;
  /**
   * A staff action on a comment (hide, unhide, delete, approve, handle, dismiss its reports). The Supabase class calls the
   * database function that checks the caller is an admin and writes the one audit entry as them; `actorMemberId` is for the
   * twin, which has no session.
   */
  moderate(commentId: string, action: ModerationAction, actorMemberId: string | null): Promise<ModerationOutcome>;
  /** Follows a lesson's thread unless the member already chose (an explicit unfollow stays). Posting and replying call it. */
  ensureFollowing(memberId: string, lessonId: string): Promise<void>;
  /** The member's own choice: follow or stop following a lesson's thread. */
  setFollowing(memberId: string, lessonId: string, following: boolean): Promise<void>;
  /** Whether the member follows the thread now. */
  isFollowing(memberId: string, lessonId: string): Promise<boolean>;
  /** The members following each of these lessons (lessons with none are absent). Reads past 1000. */
  followers(lessonIds: string[]): Promise<Map<string, string[]>>;
  /** Records that the member has now seen the thread and returns when they had last seen it, or null for a first visit. */
  markRead(memberId: string, lessonId: string, seenAt: string): Promise<string | null>;
  /** Live comments made after `since` and up to `until` (both ISO times), oldest first, on any lesson. Reads past 1000. */
  activityBetween(since: string, until: string): Promise<CommentActivity[]>;
  /** The lessons with their titles and courses (an unknown id is absent). */
  lessonInfo(lessonIds: string[]): Promise<Map<string, LessonInfo>>;
  /** Courses with comments waiting for staff (open reports or held), most waiting first. Reads past 1000. */
  moderationBacklog(): Promise<ModerationBacklogItem[]>;
  /**
   * Comment counts per lesson of a course, for the outline: only lessons with at least one live comment are present. `newCount`
   * counts what others wrote since `viewerId` last opened the thread (`lesson_comment_reads`). Reads past 1000; never the text.
   */
  outlineCounts(courseId: string, viewerId: string): Promise<Map<string, LessonCommentCounts>>;
  /** The comments imported from `source` on these lessons, deleted ones included. Reads past 1000. */
  importedOf(source: string, lessonIds: string[]): Promise<ImportedCommentRecord[]>;
  /**
   * Writes imported comments, one row per `source` + `sourceKey`: a new one is inserted, one already there has its lesson, parent,
   * author name, text, time and deleted time brought up to date, and nothing else of it (hidden, reports, follows) is touched,
   * so running it again changes nothing. No member, no follow and no notification is ever created. Returns each row's id.
   */
  upsertImported(source: string, rows: ImportedCommentWrite[]): Promise<{ sourceKey: string; id: string }[]>;
}

/** An imported comment as stored, for the import to compare with what its source says now. */
export interface ImportedCommentRecord {
  id: string;
  lessonId: string;
  sourceKey: string;
  parentId: string | null;
  authorName: string;
  body: string;
  createdAt: string;
  deletedAt: string | null;
  /** Set when a person (staff) deleted it; null when only the import did, which the import may undo. */
  deletedBy: string | null;
}

/** What the import writes for one imported comment. */
export interface ImportedCommentWrite {
  lessonId: string;
  sourceKey: string;
  /** A top-level comment's id (already in the table, or written by an earlier call); null for a question. */
  parentId: string | null;
  authorName: string;
  body: string;
  /** The time it was written at its source. */
  createdAt: string;
  deletedAt: string | null;
}

/** The columns a count needs: never the text. */
type CountRow = Pick<StoredRow, "id" | "lesson_id" | "member_id" | "parent_id" | "is_staff_reply" | "created_at" | "held_at" | "hidden_at" | "deleted_at" | "handled_at" | "source">;

type Embedded = { name: string; display_name: string | null };
type StoredRow = {
  id: string;
  lesson_id: string;
  member_id: string | null;
  parent_id: string | null;
  body: string;
  is_staff_reply: boolean;
  created_at: string;
  edited_at: string | null;
  hidden_at: string | null;
  deleted_at: string | null;
  held_at: string | null;
  handled_at: string | null;
  source: string | null;
  author_name: string | null;
};

const COLUMNS = "id, lesson_id, member_id, parent_id, body, is_staff_reply, created_at, edited_at, hidden_at, deleted_at, held_at, handled_at, source, author_name";

const record = (row: StoredRow): LessonCommentRecord => ({
  id: row.id,
  lessonId: row.lesson_id,
  memberId: row.member_id,
  parentId: row.parent_id,
  body: row.body,
  isStaffReply: row.is_staff_reply,
  createdAt: row.created_at,
  editedAt: row.edited_at,
  hiddenAt: row.hidden_at,
  deletedAt: row.deleted_at,
  heldAt: row.held_at,
  handledAt: row.handled_at,
  source: row.source,
  authorName: row.author_name,
});

/** Who wrote it, by name: the member's display name, or the name an imported comment carries when no member is behind it. */
const authorOf = (row: Pick<StoredRow, "member_id" | "author_name">, nameOf: (memberId: string) => string) =>
  row.member_id ? nameOf(row.member_id) : row.author_name || "Former member";
const memberIdsOf = (rows: Pick<StoredRow, "member_id">[]) => rows.flatMap((r) => (r.member_id ? [r.member_id] : []));

const isRemoved = (row: { hidden_at: string | null; deleted_at: string | null }) => Boolean(row.hidden_at || row.deleted_at);
/** Held and not otherwise removed. */
const isHeld = (row: { held_at: string | null; hidden_at: string | null; deleted_at: string | null }) => Boolean(row.held_at && !row.hidden_at && !row.deleted_at);
/** What everyone can read: not deleted, hidden or held. */
const isLive = (row: { held_at: string | null; hidden_at: string | null; deleted_at: string | null }) => !isRemoved(row) && !row.held_at;

/** Builds the thread from every row of a lesson as `viewer` sees it; `nameOf` gives an author's display name. Shared by both implementations. */
export function buildThread(rows: StoredRow[], nameOf: (memberId: string) => string, viewer: ThreadViewer): LessonThread {
  // What the viewer may see at all: deleted comments are tombstones for everyone, hidden ones for members; a held one is its author's and staff's.
  const canSeeHeld = (row: StoredRow) => viewer.isStaff || (row.member_id !== null && row.member_id === viewer.memberId);
  const goneFor = (row: StoredRow) => Boolean(row.deleted_at || (row.hidden_at && !viewer.isStaff));
  const present = (row: StoredRow) => !isHeld(row) || canSeeHeld(row);
  const repliesOf = new Map<string, StoredRow[]>();
  for (const row of rows) {
    if (!row.parent_id || goneFor(row) || !present(row)) continue;
    const list = repliesOf.get(row.parent_id) ?? [];
    list.push(row);
    repliesOf.set(row.parent_id, list);
  }
  const shown = (row: StoredRow): ThreadComment => {
    const removed = goneFor(row);
    return {
      id: row.id,
      lessonId: row.lesson_id,
      memberId: removed ? "" : (row.member_id ?? ""),
      parentId: row.parent_id,
      authorName: removed ? "" : authorOf(row, nameOf),
      isStaffReply: removed ? false : row.is_staff_reply,
      createdAt: row.created_at,
      editedAt: removed ? null : row.edited_at,
      removed,
      body: removed ? null : row.body,
      hidden: !removed && Boolean(row.hidden_at),
      held: !removed && isHeld(row),
      ...(row.source ? { imported: true } : {}),
    };
  };
  const byNewest = (a: StoredRow, b: StoredRow) => compareText(b.created_at, a.created_at) || compareText(b.id, a.id);
  const byOldest = (a: StoredRow, b: StoredRow) => compareText(a.created_at, b.created_at) || compareText(a.id, b.id);
  const entries: ThreadEntry[] = [];
  let count = 0;
  for (const row of rows.filter((r) => !r.parent_id && present(r)).sort(byNewest)) {
    const replies = (repliesOf.get(row.id) ?? []).sort(byOldest);
    // A removed comment with nothing under it is gone; one with replies stays as a tombstone so they keep their place.
    if (goneFor(row) && replies.length === 0) continue;
    if (isLive(row)) count += 1;
    count += replies.filter(isLive).length;
    entries.push({ comment: shown(row), replies: replies.map(shown) });
  }
  return { entries, count };
}

/** The questions with no live staff reply that nobody has marked handled, oldest first; `lessonTitle` and `nameOf` come from the caller's join. */
export function pickUnanswered(
  rows: StoredRow[],
  lessonTitle: (lessonId: string) => string,
  nameOf: (memberId: string) => string,
): UnansweredQuestion[] {
  const answered = new Set(rows.filter((r) => r.parent_id && r.is_staff_reply && isLive(r)).map((r) => r.parent_id as string));
  return rows
    // An imported question is old and was answered (or not) on the site it came from: it never joins the list.
    .filter((r) => !r.parent_id && isLive(r) && !answered.has(r.id) && !r.is_staff_reply && !r.handled_at && !r.source)
    .sort((a, b) => compareText(a.created_at, b.created_at) || compareText(a.id, b.id))
    .map((r) => ({ id: r.id, lessonId: r.lesson_id, lessonTitle: lessonTitle(r.lesson_id), authorName: authorOf(r, nameOf), createdAt: r.created_at, body: r.body }));
}

type ReportRow = { comment_id: string; reason: string; created_at: string };
type ReportEmbed = ReportRow & { id: string; lesson_comments: StoredRow };

const REPORT_SELECT =
  "id, comment_id, reason, created_at, lesson_comments!inner(id, lesson_id, member_id, parent_id, body, is_staff_reply, created_at, edited_at, hidden_at, deleted_at, held_at, handled_at, source, author_name)";

/** Groups open reports by comment, most reported first (then oldest first). A comment that is deleted or hidden is left out: its reports are settled. */
export function groupReports(
  reports: ReportRow[],
  commentOf: (commentId: string) => StoredRow | undefined,
  lessonTitle: (lessonId: string) => string,
  nameOf: (memberId: string) => string,
): ReportedComment[] {
  const byComment = new Map<string, ReportRow[]>();
  for (const report of reports) {
    const list = byComment.get(report.comment_id) ?? [];
    list.push(report);
    byComment.set(report.comment_id, list);
  }
  const out: ReportedComment[] = [];
  for (const [commentId, list] of byComment) {
    const row = commentOf(commentId);
    if (!row || isRemoved(row)) continue;
    const sorted = [...list].sort((a, b) => compareText(a.created_at, b.created_at));
    out.push({
      commentId,
      lessonId: row.lesson_id,
      lessonTitle: lessonTitle(row.lesson_id),
      authorName: authorOf(row, nameOf),
      body: row.body,
      isReply: Boolean(row.parent_id),
      state: row.held_at ? "held" : "visible",
      reportCount: list.length,
      reasons: sorted.map((r) => r.reason),
      firstReportedAt: sorted[0].created_at,
    });
  }
  return out.sort((a, b) => b.reportCount - a.reportCount || compareText(a.firstReportedAt, b.firstReportedAt) || compareText(a.commentId, b.commentId));
}

export function pickHeld(rows: StoredRow[], lessonTitle: (lessonId: string) => string, nameOf: (memberId: string) => string): HeldComment[] {
  return rows
    .filter((r) => isHeld(r))
    .sort((a, b) => compareText(a.created_at, b.created_at) || compareText(a.id, b.id))
    .map((r) => ({ id: r.id, lessonId: r.lesson_id, lessonTitle: lessonTitle(r.lesson_id), authorName: authorOf(r, nameOf), body: r.body, isReply: Boolean(r.parent_id), createdAt: r.created_at }));
}

/** The notification senders' view of comments: no text. */
function activityOf(rows: StoredRow[]): CommentActivity[] {
  return rows
    // An imported comment is history, not activity: it never reaches a digest.
    .flatMap((r) => (r.member_id && !r.source ? [{ ...r, member_id: r.member_id }] : []))
    .map((r) => ({ id: r.id, lessonId: r.lesson_id, memberId: r.member_id, parentId: r.parent_id, isStaffReply: r.is_staff_reply, createdAt: r.created_at }))
    .sort((a, b) => compareText(a.createdAt, b.createdAt) || compareText(a.id, b.id));
}

function lessonInfoMap(lessons: { id: string; title: string; course_id: string }[], courses: { id: string; slug: string; title: string }[]): Map<string, LessonInfo> {
  const courseOf = new Map(courses.map((c) => [c.id, c]));
  const out = new Map<string, LessonInfo>();
  for (const lesson of lessons) {
    const course = courseOf.get(lesson.course_id);
    if (course) out.set(lesson.id, { lessonId: lesson.id, title: lesson.title, courseId: course.id, courseTitle: course.title, courseSlug: course.slug });
  }
  return out;
}

/** Counts what waits per course: `heldLessonIds` has one entry per held comment, `reported` one per comment with an open report. Most waiting first. */
export function groupBacklog(
  heldLessonIds: string[],
  reported: { commentId: string; lessonId: string }[],
  info: Map<string, LessonInfo>,
): ModerationBacklogItem[] {
  const byCourse = new Map<string, ModerationBacklogItem>();
  const item = (lessonId: string) => {
    const lesson = info.get(lessonId);
    if (!lesson) return null;
    let entry = byCourse.get(lesson.courseId);
    if (!entry) {
      entry = { courseId: lesson.courseId, courseTitle: lesson.courseTitle, reported: 0, held: 0 };
      byCourse.set(lesson.courseId, entry);
    }
    return entry;
  };
  for (const lessonId of heldLessonIds) {
    const entry = item(lessonId);
    if (entry) entry.held += 1;
  }
  const seen = new Set<string>();
  for (const { commentId, lessonId } of reported) {
    if (seen.has(commentId)) continue;
    seen.add(commentId);
    const entry = item(lessonId);
    if (entry) entry.reported += 1;
  }
  return [...byCourse.values()].sort((a, b) => b.reported + b.held - (a.reported + a.held) || compareText(a.courseId, b.courseId));
}

/** Counts live comments per lesson: the total, the unanswered questions, and what is new to the viewer since `seenAt(lessonId)`. Shared by both implementations. */
export function tallyLessons(rows: CountRow[], seenAt: (lessonId: string) => string | null, viewerId: string): Map<string, LessonCommentCounts> {
  const live = rows.filter((r) => isLive(r));
  const answered = new Set(live.filter((r) => r.parent_id && r.is_staff_reply).map((r) => r.parent_id as string));
  const out = new Map<string, LessonCommentCounts>();
  for (const row of live) {
    const counts = out.get(row.lesson_id) ?? { total: 0, unanswered: 0, newCount: 0 };
    counts.total += 1;
    // An imported comment is history: it counts in the total, but is never an open question and never new.
    if (!row.parent_id && !row.is_staff_reply && !row.handled_at && !row.source && !answered.has(row.id)) counts.unanswered += 1;
    const seen = seenAt(row.lesson_id);
    if (seen && !row.source && row.member_id !== viewerId && Date.parse(row.created_at) > Date.parse(seen)) counts.newCount += 1;
    out.set(row.lesson_id, counts);
  }
  return out;
}

export class SupabaseCourseCommentRepository implements CourseCommentRepository {
  constructor(private readonly db: Db) {}

  async create(comment: NewLessonComment) {
    const row = must(
      await this.db
        .from("lesson_comments")
        .insert({
          lesson_id: comment.lessonId,
          member_id: comment.memberId,
          parent_id: comment.parentId,
          body: comment.body,
          is_staff_reply: comment.isStaffReply,
          ...(comment.held ? { held_at: new Date().toISOString(), held_reason: "links" } : {}),
        })
        .select(COLUMNS)
        .single(),
    );
    if (!row) throw new Error("lesson_comments insert returned no row");
    return record(row);
  }

  async byId(id: string) {
    const row = must(await this.db.from("lesson_comments").select(COLUMNS).eq("id", id).maybeSingle());
    return row ? record(row) : null;
  }

  async edit(id: string, body: string, editedAt: string) {
    const row = must(await this.db.from("lesson_comments").update({ body, edited_at: editedAt }).eq("id", id).select(COLUMNS).maybeSingle());
    return row ? record(row) : null;
  }

  async softDelete(id: string, deletedBy: string, deletedAt: string) {
    const existing = await this.byId(id);
    if (!existing) return false;
    if (existing.deletedAt) return true;
    must(await this.db.from("lesson_comments").update({ deleted_at: deletedAt, deleted_by: deletedBy }).eq("id", id).is("deleted_at", null));
    return true;
  }

  private async authorNames(memberIds: string[]): Promise<Map<string, string>> {
    const rows = await inChunks(memberIds, 200, async (part) => must(await this.db.from("members").select("id, name, display_name").in("id", part)) ?? []);
    return new Map(rows.map((m) => [m.id, getMemberDisplayName(m as Embedded)]));
  }

  async threadFor(lessonId: string, viewer: ThreadViewer) {
    const rows = await fetchAllRows<StoredRow>((from, to) =>
      this.db.from("lesson_comments").select(COLUMNS).eq("lesson_id", lessonId).order("id").range(from, to),
    );
    const names = await this.authorNames(memberIdsOf(rows.filter((r) => !r.deleted_at && (viewer.isStaff || !isRemoved(r)))));
    return buildThread(rows, (id) => names.get(id) ?? "Former member", viewer);
  }

  async report(input: { commentId: string; reporterId: string; reason: string }): Promise<ReportOutcome> {
    const { error } = await this.db.from("lesson_comment_reports").insert({ comment_id: input.commentId, reporter_id: input.reporterId, reason: input.reason });
    if (!error) return "reported";
    // The one open report per reporter and comment (unique index), and a comment that is not there (foreign key).
    if (error.code === "23505") return "already_reported";
    if (error.code === "23503") return "not_found";
    throw new Error(error.message);
  }

  private async lessonTitles(courseId: string): Promise<Map<string, string>> {
    const lessons = must(await this.db.from("course_lessons").select("id, title").eq("course_id", courseId));
    return new Map((lessons ?? []).map((l) => [l.id, l.title]));
  }

  async openReports(courseId: string) {
    const titles = await this.lessonTitles(courseId);
    const rows = await inChunks([...titles.keys()], 100, (part) =>
      fetchAllRows<ReportEmbed>((from, to) =>
        this.db
          .from("lesson_comment_reports")
          .select(REPORT_SELECT)
          .is("resolved_at", null)
          .in("lesson_comments.lesson_id", part)
          .order("id")
          .range(from, to)
          .overrideTypes<ReportEmbed[], { merge: false }>(),
      ),
    );
    const comments = new Map(rows.map((r) => [r.lesson_comments.id, r.lesson_comments]));
    const names = await this.authorNames(memberIdsOf([...comments.values()]));
    return groupReports(rows, (id) => comments.get(id), (id) => titles.get(id) ?? "", (id) => names.get(id) ?? "Former member");
  }

  async heldComments(courseId: string) {
    const titles = await this.lessonTitles(courseId);
    const rows = (await inChunks([...titles.keys()], 100, (part) =>
      fetchAllRows<StoredRow>((from, to) =>
        this.db.from("lesson_comments").select(COLUMNS).in("lesson_id", part).not("held_at", "is", null).is("deleted_at", null).is("hidden_at", null).order("id").range(from, to),
      ),
    )) as StoredRow[];
    const names = await this.authorNames(memberIdsOf(rows));
    return pickHeld(rows, (id) => titles.get(id) ?? "", (id) => names.get(id) ?? "Former member");
  }

  async moderate(commentId: string, action: ModerationAction): Promise<ModerationOutcome> {
    const outcome = must(await this.db.rpc("moderate_lesson_comment", { p_comment_id: commentId, p_action: action }));
    return outcome === "done" || outcome === "no_change" || outcome === "not_found" ? outcome : "not_found";
  }

  async ensureFollowing(memberId: string, lessonId: string) {
    must(await this.db.from("lesson_comment_follows").upsert({ member_id: memberId, lesson_id: lessonId, following: true }, { onConflict: "member_id,lesson_id", ignoreDuplicates: true }));
  }

  async setFollowing(memberId: string, lessonId: string, following: boolean) {
    must(
      await this.db
        .from("lesson_comment_follows")
        .upsert({ member_id: memberId, lesson_id: lessonId, following, updated_at: new Date().toISOString() }, { onConflict: "member_id,lesson_id" }),
    );
  }

  async isFollowing(memberId: string, lessonId: string) {
    const row = must(await this.db.from("lesson_comment_follows").select("following").eq("member_id", memberId).eq("lesson_id", lessonId).maybeSingle());
    return row?.following === true;
  }

  async followers(lessonIds: string[]) {
    const rows = await inChunks(lessonIds, 100, (part) =>
      fetchAllRows<{ member_id: string; lesson_id: string }>((from, to) =>
        this.db.from("lesson_comment_follows").select("member_id, lesson_id").in("lesson_id", part).eq("following", true).order("id").range(from, to),
      ),
    );
    const out = new Map<string, string[]>();
    for (const row of rows) out.set(row.lesson_id, [...(out.get(row.lesson_id) ?? []), row.member_id]);
    return out;
  }

  async markRead(memberId: string, lessonId: string, seenAt: string) {
    const previous = must(await this.db.from("lesson_comment_reads").select("last_seen_at").eq("member_id", memberId).eq("lesson_id", lessonId).maybeSingle());
    must(await this.db.from("lesson_comment_reads").upsert({ member_id: memberId, lesson_id: lessonId, last_seen_at: seenAt }, { onConflict: "member_id,lesson_id" }));
    return previous?.last_seen_at ?? null;
  }

  async activityBetween(since: string, until: string) {
    const rows = await fetchAllRows<StoredRow>((from, to) =>
      this.db
        .from("lesson_comments")
        .select(COLUMNS)
        .gt("created_at", since)
        .lte("created_at", until)
        .is("deleted_at", null)
        .is("hidden_at", null)
        .is("held_at", null)
        .is("source", null)
        .order("id")
        .range(from, to),
    );
    return activityOf(rows);
  }

  async lessonInfo(lessonIds: string[]) {
    const lessons = await inChunks([...new Set(lessonIds)], 200, async (part) => must(await this.db.from("course_lessons").select("id, title, course_id").in("id", part)) ?? []);
    const courses = await inChunks([...new Set(lessons.map((l) => l.course_id))], 200, async (part) => must(await this.db.from("courses").select("id, slug, title").in("id", part)) ?? []);
    return lessonInfoMap(lessons, courses);
  }

  async moderationBacklog() {
    type ReportedRow = { id: string; comment_id: string; lesson_comments: { lesson_id: string; hidden_at: string | null; deleted_at: string | null } };
    const held = await fetchAllRows<{ id: string; lesson_id: string }>((from, to) =>
      this.db.from("lesson_comments").select("id, lesson_id").not("held_at", "is", null).is("deleted_at", null).is("hidden_at", null).order("id").range(from, to),
    );
    const reports = await fetchAllRows<ReportedRow>((from, to) =>
      this.db
        .from("lesson_comment_reports")
        .select("id, comment_id, lesson_comments!inner(lesson_id, hidden_at, deleted_at)")
        .is("resolved_at", null)
        .order("id")
        .range(from, to)
        .overrideTypes<ReportedRow[], { merge: false }>(),
    );
    const reported = reports.filter((r) => !r.lesson_comments.hidden_at && !r.lesson_comments.deleted_at).map((r) => ({ commentId: r.comment_id, lessonId: r.lesson_comments.lesson_id }));
    const info = await this.lessonInfo([...held.map((h) => h.lesson_id), ...reported.map((r) => r.lessonId)]);
    return groupBacklog(held.map((h) => h.lesson_id), reported, info);
  }

  async outlineCounts(courseId: string, viewerId: string) {
    const lessonIds = [...(await this.lessonTitles(courseId)).keys()];
    const [rows, reads] = await Promise.all([
      inChunks(lessonIds, 100, (part) =>
        fetchAllRows<CountRow>((from, to) =>
          this.db
            .from("lesson_comments")
            .select("id, lesson_id, member_id, parent_id, is_staff_reply, created_at, held_at, hidden_at, deleted_at, handled_at, source")
            .in("lesson_id", part)
            .is("deleted_at", null)
            .is("hidden_at", null)
            .order("id")
            .range(from, to),
        ),
      ),
      inChunks(lessonIds, 100, async (part) => must(await this.db.from("lesson_comment_reads").select("lesson_id, last_seen_at").eq("member_id", viewerId).in("lesson_id", part)) ?? []),
    ]);
    const seen = new Map(reads.map((r) => [r.lesson_id, r.last_seen_at]));
    return tallyLessons(rows, (id) => seen.get(id) ?? null, viewerId);
  }

  async unansweredQuestions(courseId: string) {
    const titles = await this.lessonTitles(courseId);
    const lessonIds = [...titles.keys()];
    const rows = (
      await inChunks(lessonIds, 100, (part) =>
        fetchAllRows<StoredRow>((from, to) =>
          this.db.from("lesson_comments").select(COLUMNS).in("lesson_id", part).is("deleted_at", null).is("hidden_at", null).order("id").range(from, to),
        ),
      )
    ) as StoredRow[];
    const names = await this.authorNames(memberIdsOf(rows.filter((r) => !r.parent_id)));
    return pickUnanswered(rows, (id) => titles.get(id) ?? "", (id) => names.get(id) ?? "Former member");
  }

  async importedOf(source: string, lessonIds: string[]) {
    type Row = { id: string; lesson_id: string; source_key: string | null; parent_id: string | null; author_name: string | null; body: string; created_at: string; deleted_at: string | null; deleted_by: string | null };
    const rows = await inChunks(lessonIds, 100, (part) =>
      fetchAllRows<Row>((from, to) =>
        this.db
          .from("lesson_comments")
          .select("id, lesson_id, source_key, parent_id, author_name, body, created_at, deleted_at, deleted_by")
          .eq("source", source)
          .in("lesson_id", part)
          .order("id")
          .range(from, to),
      ),
    );
    return rows.map(importedRecord);
  }

  async upsertImported(source: string, rows: ImportedCommentWrite[]) {
    const written: { sourceKey: string; id: string }[] = [];
    for (let i = 0; i < rows.length; i += IMPORT_CHUNK) {
      const batch = rows.slice(i, i + IMPORT_CHUNK).map((r) => ({
        source,
        source_key: r.sourceKey,
        lesson_id: r.lessonId,
        parent_id: r.parentId,
        author_name: r.authorName,
        body: r.body,
        created_at: r.createdAt,
        deleted_at: r.deletedAt,
      }));
      const data = must(await this.db.from("lesson_comments").upsert(batch, { onConflict: "source,source_key" }).select("id, source_key"));
      for (const row of data ?? []) if (row.source_key) written.push({ sourceKey: row.source_key, id: row.id });
    }
    return written;
  }
}

const IMPORT_CHUNK = 500;

const importedRecord = (row: { id: string; lesson_id: string; source_key: string | null; parent_id: string | null; author_name: string | null; body: string; created_at: string; deleted_at: string | null; deleted_by: string | null }): ImportedCommentRecord => ({
  id: row.id,
  lessonId: row.lesson_id,
  sourceKey: row.source_key ?? "",
  parentId: row.parent_id,
  authorName: row.author_name ?? "",
  body: row.body,
  createdAt: row.created_at,
  deletedAt: row.deleted_at,
  deletedBy: row.deleted_by,
});

const BASE58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

/** The next id in order: `cmnt_` and 12 base58 digits counting up from the rows held, so ids sort in the order they were made. */
export function nextCommentId(data: Pick<InMemoryDataset, "lessonComments">): string {
  return `cmnt_${base58Counter(data.lessonComments.length + 1)}`;
}

function base58Counter(count: number): string {
  let n = count;
  let digits = "";
  while (digits.length < 12) {
    digits = BASE58[n % 58] + digits;
    n = Math.floor(n / 58);
  }
  return digits;
}

/** In-memory twin over an `InMemoryDataset`. */
export class InMemoryCourseCommentRepository implements CourseCommentRepository {
  constructor(private readonly data: InMemoryDataset) {}

  private name(memberId: string): string {
    const member = this.data.members.find((m) => m.id === memberId);
    return member ? getMemberDisplayName({ name: member.name, display_name: member.displayName ?? null }) : "Former member";
  }

  async create(comment: NewLessonComment) {
    if (comment.body.length < 1 || comment.body.length > 4000) throw new Error('new row for relation "lesson_comments" violates check constraint "lesson_comments_body_check"');
    if (comment.parentId) {
      const parent = this.data.lessonComments.find((c) => c.id === comment.parentId);
      if (!parent) throw new Error("The comment being replied to does not exist");
      if (parent.parent_id) throw new Error("A reply goes under a top-level comment, not under another reply");
      if (parent.lesson_id !== comment.lessonId) throw new Error("A reply belongs to the same lesson as the comment it answers");
    }
    const row: StoredRow = {
      id: nextCommentId(this.data),
      lesson_id: comment.lessonId,
      member_id: comment.memberId,
      parent_id: comment.parentId,
      body: comment.body,
      is_staff_reply: comment.isStaffReply,
      created_at: new Date().toISOString(),
      edited_at: null,
      hidden_at: null,
      deleted_at: null,
      held_at: comment.held ? new Date().toISOString() : null,
      handled_at: null,
      source: null,
      author_name: null,
    };
    this.data.lessonComments.push({ ...row, deleted_by: null, handled_by: null, held_reason: comment.held ? "links" : null, source_key: null });
    return record(row);
  }

  async byId(id: string) {
    const row = this.data.lessonComments.find((c) => c.id === id);
    return row ? record(row) : null;
  }

  async edit(id: string, body: string, editedAt: string) {
    const row = this.data.lessonComments.find((c) => c.id === id);
    if (!row) return null;
    if (body.length < 1 || body.length > 4000) throw new Error('new row for relation "lesson_comments" violates check constraint "lesson_comments_body_check"');
    row.body = body;
    row.edited_at = editedAt;
    return record(row);
  }

  async softDelete(id: string, deletedBy: string, deletedAt: string) {
    const row = this.data.lessonComments.find((c) => c.id === id);
    if (!row) return false;
    if (!row.deleted_at) {
      row.deleted_at = deletedAt;
      row.deleted_by = deletedBy;
    }
    return true;
  }

  async threadFor(lessonId: string, viewer: ThreadViewer) {
    return buildThread(
      this.data.lessonComments.filter((c) => c.lesson_id === lessonId),
      (id) => this.name(id),
      viewer,
    );
  }

  async report(input: { commentId: string; reporterId: string; reason: string }): Promise<ReportOutcome> {
    if (input.reason.length < 1 || input.reason.length > 500) throw new Error('new row for relation "lesson_comment_reports" violates check constraint "lesson_comment_reports_reason_check"');
    if (!this.data.lessonComments.some((c) => c.id === input.commentId)) return "not_found";
    if (this.data.lessonCommentReports.some((r) => r.comment_id === input.commentId && r.reporter_id === input.reporterId && !r.resolved_at)) return "already_reported";
    this.data.lessonCommentReports.push({
      id: `cmrp_${base58Counter(this.data.lessonCommentReports.length + 1)}`,
      comment_id: input.commentId,
      reporter_id: input.reporterId,
      reason: input.reason,
      created_at: new Date().toISOString(),
      resolved_at: null,
      resolved_by: null,
    });
    return "reported";
  }

  private titles(courseId: string): Map<string, string> {
    return new Map(this.data.courseLessons.filter((l) => l.course_id === courseId).map((l) => [l.id, l.title]));
  }

  async openReports(courseId: string) {
    const titles = this.titles(courseId);
    const comments = new Map(this.data.lessonComments.filter((c) => titles.has(c.lesson_id)).map((c) => [c.id, c]));
    const open = this.data.lessonCommentReports.filter((r) => !r.resolved_at && comments.has(r.comment_id));
    return groupReports(open, (id) => comments.get(id), (id) => titles.get(id) ?? "", (id) => this.name(id));
  }

  async heldComments(courseId: string) {
    const titles = this.titles(courseId);
    return pickHeld(this.data.lessonComments.filter((c) => titles.has(c.lesson_id)), (id) => titles.get(id) ?? "", (id) => this.name(id));
  }

  async moderate(commentId: string, action: ModerationAction, actorMemberId: string | null): Promise<ModerationOutcome> {
    const row = this.data.lessonComments.find((c) => c.id === commentId);
    if (!row) return "not_found";
    const now = new Date().toISOString();
    const settle = () => {
      let n = 0;
      for (const report of this.data.lessonCommentReports) {
        if (report.comment_id === commentId && !report.resolved_at) {
          report.resolved_at = now;
          report.resolved_by = actorMemberId;
          n += 1;
        }
      }
      return n;
    };
    if (action === "hide") {
      if (row.deleted_at || row.hidden_at) return "no_change";
      row.hidden_at = now;
      settle();
    } else if (action === "unhide") {
      if (row.deleted_at || !row.hidden_at) return "no_change";
      row.hidden_at = null;
    } else if (action === "delete") {
      if (row.deleted_at) return "no_change";
      row.deleted_at = now;
      row.deleted_by = actorMemberId;
      settle();
    } else if (action === "approve") {
      if (row.deleted_at || !row.held_at) return "no_change";
      row.held_at = null;
      row.held_reason = null;
    } else if (action === "handle") {
      if (row.parent_id || row.deleted_at || row.handled_at) return "no_change";
      row.handled_at = now;
      row.handled_by = actorMemberId;
    } else if (settle() === 0) {
      return "no_change";
    }
    return "done";
  }

  async ensureFollowing(memberId: string, lessonId: string) {
    if (this.data.lessonCommentFollows.some((f) => f.member_id === memberId && f.lesson_id === lessonId)) return;
    const now = new Date().toISOString();
    this.data.lessonCommentFollows.push({ id: `cmfw_${base58Counter(this.data.lessonCommentFollows.length + 1)}`, member_id: memberId, lesson_id: lessonId, following: true, created_at: now, updated_at: now });
  }

  async setFollowing(memberId: string, lessonId: string, following: boolean) {
    const now = new Date().toISOString();
    const row = this.data.lessonCommentFollows.find((f) => f.member_id === memberId && f.lesson_id === lessonId);
    if (row) {
      row.following = following;
      row.updated_at = now;
      return;
    }
    this.data.lessonCommentFollows.push({ id: `cmfw_${base58Counter(this.data.lessonCommentFollows.length + 1)}`, member_id: memberId, lesson_id: lessonId, following, created_at: now, updated_at: now });
  }

  async isFollowing(memberId: string, lessonId: string) {
    return this.data.lessonCommentFollows.some((f) => f.member_id === memberId && f.lesson_id === lessonId && f.following);
  }

  async followers(lessonIds: string[]) {
    const wanted = new Set(lessonIds);
    const out = new Map<string, string[]>();
    for (const row of this.data.lessonCommentFollows) {
      if (row.following && wanted.has(row.lesson_id)) out.set(row.lesson_id, [...(out.get(row.lesson_id) ?? []), row.member_id]);
    }
    return out;
  }

  async markRead(memberId: string, lessonId: string, seenAt: string) {
    const row = this.data.lessonCommentReads.find((r) => r.member_id === memberId && r.lesson_id === lessonId);
    if (row) {
      const previous = row.last_seen_at;
      row.last_seen_at = seenAt;
      return previous;
    }
    this.data.lessonCommentReads.push({ id: `cmrd_${base58Counter(this.data.lessonCommentReads.length + 1)}`, member_id: memberId, lesson_id: lessonId, last_seen_at: seenAt });
    return null;
  }

  async activityBetween(since: string, until: string) {
    return activityOf(this.data.lessonComments.filter((c) => c.created_at > since && c.created_at <= until && isLive(c) && !c.source));
  }

  async lessonInfo(lessonIds: string[]) {
    const wanted = new Set(lessonIds);
    return lessonInfoMap(
      this.data.courseLessons.filter((l) => wanted.has(l.id)),
      this.data.courses,
    );
  }

  async moderationBacklog() {
    const held = this.data.lessonComments.filter((c) => isHeld(c));
    const comments = new Map(this.data.lessonComments.map((c) => [c.id, c]));
    const reported = this.data.lessonCommentReports
      .filter((r) => !r.resolved_at)
      .flatMap((r) => {
        const c = comments.get(r.comment_id);
        return c && !isRemoved(c) ? [{ commentId: c.id, lessonId: c.lesson_id }] : [];
      });
    const info = await this.lessonInfo([...held.map((h) => h.lesson_id), ...reported.map((r) => r.lessonId)]);
    return groupBacklog(held.map((h) => h.lesson_id), reported, info);
  }

  async outlineCounts(courseId: string, viewerId: string) {
    const lessonIds = new Set(this.data.courseLessons.filter((l) => l.course_id === courseId).map((l) => l.id));
    const seen = new Map(this.data.lessonCommentReads.filter((r) => r.member_id === viewerId).map((r) => [r.lesson_id, r.last_seen_at]));
    return tallyLessons(
      this.data.lessonComments.filter((c) => lessonIds.has(c.lesson_id)),
      (id) => seen.get(id) ?? null,
      viewerId,
    );
  }

  async unansweredQuestions(courseId: string) {
    const lessons = this.data.courseLessons.filter((l) => l.course_id === courseId);
    const titles = new Map(lessons.map((l) => [l.id, l.title]));
    const rows = this.data.lessonComments.filter((c) => titles.has(c.lesson_id));
    return pickUnanswered(rows, (id) => titles.get(id) ?? "", (id) => this.name(id));
  }

  async importedOf(source: string, lessonIds: string[]) {
    const wanted = new Set(lessonIds);
    return this.data.lessonComments.filter((c) => c.source === source && wanted.has(c.lesson_id)).map(importedRecord);
  }

  async upsertImported(source: string, rows: ImportedCommentWrite[]) {
    const written: { sourceKey: string; id: string }[] = [];
    for (const r of rows) {
      if (r.body.length < 1 || r.body.length > 4000) throw new Error('new row for relation "lesson_comments" violates check constraint "lesson_comments_body_check"');
      if (r.authorName.length < 1 || r.authorName.length > 200) throw new Error('new row for relation "lesson_comments" violates check constraint "lesson_comments_origin_check"');
      if (r.parentId) {
        const parent = this.data.lessonComments.find((c) => c.id === r.parentId);
        if (!parent) throw new Error("The comment being replied to does not exist");
        if (parent.parent_id) throw new Error("A reply goes under a top-level comment, not under another reply");
        if (parent.lesson_id !== r.lessonId) throw new Error("A reply belongs to the same lesson as the comment it answers");
      }
      const existing = this.data.lessonComments.find((c) => c.source === source && c.source_key === r.sourceKey);
      if (existing) {
        Object.assign(existing, { lesson_id: r.lessonId, parent_id: r.parentId, author_name: r.authorName, body: r.body, created_at: r.createdAt, deleted_at: r.deletedAt });
        written.push({ sourceKey: r.sourceKey, id: existing.id });
        continue;
      }
      const id = nextCommentId(this.data);
      this.data.lessonComments.push({
        id,
        lesson_id: r.lessonId,
        member_id: null,
        parent_id: r.parentId,
        body: r.body,
        is_staff_reply: false,
        created_at: r.createdAt,
        edited_at: null,
        hidden_at: null,
        deleted_at: r.deletedAt,
        deleted_by: null,
        held_at: null,
        held_reason: null,
        handled_at: null,
        handled_by: null,
        source,
        source_key: r.sourceKey,
        author_name: r.authorName,
      });
      written.push({ sourceKey: r.sourceKey, id });
    }
    return written;
  }
}
