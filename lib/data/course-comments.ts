import { fetchAllRows } from "@/lib/supabase/paginate";
import { getMemberDisplayName } from "@/lib/member-display-name";
import type { Db } from "./db";
import type { InMemoryDataset } from "./in-memory";
import { compareText, inChunks, must } from "./query";

/**
 * Lesson comments (`lesson_comments`, docs/COURSES.md "Lesson comments"): questions and answers on a course lesson, plain
 * text, one level of replies. Reads and writes here are as the client's role says: the member pages use the service role
 * scoped to the effective member (the actions decide who may post), and row-level security is the second layer for a
 * signed-in client. Text is stored as typed and never decoded or escaped here. Throws on a database error.
 */

/** A comment as stored. */
export interface LessonCommentRecord {
  id: string;
  lessonId: string;
  memberId: string;
  parentId: string | null;
  body: string;
  isStaffReply: boolean;
  createdAt: string;
  editedAt: string | null;
  hiddenAt: string | null;
  deletedAt: string | null;
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

export interface NewLessonComment {
  lessonId: string;
  memberId: string;
  /** A top-level comment's id; null for a new question. */
  parentId: string | null;
  body: string;
  isStaffReply: boolean;
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
  /** A lesson's comments as a thread (newest question first, replies oldest first). Reads every row past 1000. */
  threadFor(lessonId: string): Promise<LessonThread>;
  /** The live top-level comments of a course's lessons with no live staff reply, oldest first. */
  unansweredQuestions(courseId: string): Promise<UnansweredQuestion[]>;
}

type Embedded = { name: string; display_name: string | null };
type StoredRow = {
  id: string;
  lesson_id: string;
  member_id: string;
  parent_id: string | null;
  body: string;
  is_staff_reply: boolean;
  created_at: string;
  edited_at: string | null;
  hidden_at: string | null;
  deleted_at: string | null;
};

const COLUMNS = "id, lesson_id, member_id, parent_id, body, is_staff_reply, created_at, edited_at, hidden_at, deleted_at";

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
});

const isRemoved = (row: { hidden_at: string | null; deleted_at: string | null }) => Boolean(row.hidden_at || row.deleted_at);

/** Builds the thread from every row of a lesson; `nameOf` gives an author's display name. Shared by both implementations. */
export function buildThread(rows: StoredRow[], nameOf: (memberId: string) => string): LessonThread {
  const repliesOf = new Map<string, StoredRow[]>();
  for (const row of rows) {
    if (!row.parent_id || isRemoved(row)) continue;
    const list = repliesOf.get(row.parent_id) ?? [];
    list.push(row);
    repliesOf.set(row.parent_id, list);
  }
  const shown = (row: StoredRow): ThreadComment => {
    const removed = isRemoved(row);
    return {
      id: row.id,
      lessonId: row.lesson_id,
      memberId: removed ? "" : row.member_id,
      parentId: row.parent_id,
      authorName: removed ? "" : nameOf(row.member_id),
      isStaffReply: removed ? false : row.is_staff_reply,
      createdAt: row.created_at,
      editedAt: removed ? null : row.edited_at,
      removed,
      body: removed ? null : row.body,
    };
  };
  const byNewest = (a: StoredRow, b: StoredRow) => compareText(b.created_at, a.created_at) || compareText(b.id, a.id);
  const byOldest = (a: StoredRow, b: StoredRow) => compareText(a.created_at, b.created_at) || compareText(a.id, b.id);
  const entries: ThreadEntry[] = [];
  let count = 0;
  for (const row of rows.filter((r) => !r.parent_id).sort(byNewest)) {
    const replies = (repliesOf.get(row.id) ?? []).sort(byOldest);
    // A removed comment with nothing under it is gone; one with replies stays as a tombstone so they keep their place.
    if (isRemoved(row) && replies.length === 0) continue;
    if (!isRemoved(row)) count += 1;
    count += replies.length;
    entries.push({ comment: shown(row), replies: replies.map(shown) });
  }
  return { entries, count };
}

/** The questions with no live staff reply, oldest first; `lessonTitle` and `nameOf` come from the caller's join. */
export function pickUnanswered(
  rows: StoredRow[],
  lessonTitle: (lessonId: string) => string,
  nameOf: (memberId: string) => string,
): UnansweredQuestion[] {
  const answered = new Set(rows.filter((r) => r.parent_id && r.is_staff_reply && !isRemoved(r)).map((r) => r.parent_id as string));
  return rows
    .filter((r) => !r.parent_id && !isRemoved(r) && !answered.has(r.id) && !r.is_staff_reply)
    .sort((a, b) => compareText(a.created_at, b.created_at) || compareText(a.id, b.id))
    .map((r) => ({ id: r.id, lessonId: r.lesson_id, lessonTitle: lessonTitle(r.lesson_id), authorName: nameOf(r.member_id), createdAt: r.created_at, body: r.body }));
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

  async threadFor(lessonId: string) {
    const rows = await fetchAllRows<StoredRow>((from, to) =>
      this.db.from("lesson_comments").select(COLUMNS).eq("lesson_id", lessonId).order("id").range(from, to),
    );
    const names = await this.authorNames(rows.filter((r) => !isRemoved(r)).map((r) => r.member_id));
    return buildThread(rows, (id) => names.get(id) ?? "Former member");
  }

  async unansweredQuestions(courseId: string) {
    const lessons = must(await this.db.from("course_lessons").select("id, title").eq("course_id", courseId));
    const titles = new Map((lessons ?? []).map((l) => [l.id, l.title]));
    const lessonIds = [...titles.keys()];
    const rows = (
      await inChunks(lessonIds, 100, (part) =>
        fetchAllRows<StoredRow>((from, to) =>
          this.db.from("lesson_comments").select(COLUMNS).in("lesson_id", part).is("deleted_at", null).is("hidden_at", null).order("id").range(from, to),
        ),
      )
    ) as StoredRow[];
    const names = await this.authorNames(rows.filter((r) => !r.parent_id).map((r) => r.member_id));
    return pickUnanswered(rows, (id) => titles.get(id) ?? "", (id) => names.get(id) ?? "Former member");
  }
}

const BASE58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

/** The next id in order: `cmnt_` and 12 base58 digits counting up from the rows held, so ids sort in the order they were made. */
export function nextCommentId(data: Pick<InMemoryDataset, "lessonComments">): string {
  let n = data.lessonComments.length + 1;
  let digits = "";
  while (digits.length < 12) {
    digits = BASE58[n % 58] + digits;
    n = Math.floor(n / 58);
  }
  return `cmnt_${digits}`;
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
    };
    this.data.lessonComments.push({ ...row, deleted_by: null });
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

  async threadFor(lessonId: string) {
    return buildThread(
      this.data.lessonComments.filter((c) => c.lesson_id === lessonId),
      (id) => this.name(id),
    );
  }

  async unansweredQuestions(courseId: string) {
    const lessons = this.data.courseLessons.filter((l) => l.course_id === courseId);
    const titles = new Map(lessons.map((l) => [l.id, l.title]));
    const rows = this.data.lessonComments.filter((c) => titles.has(c.lesson_id));
    return pickUnanswered(rows, (id) => titles.get(id) ?? "", (id) => this.name(id));
  }
}
