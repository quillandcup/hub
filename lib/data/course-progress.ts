import { fetchAllRows } from "@/lib/supabase/paginate";
import { chunk } from "@/lib/supabase/paginate";
import { compareText, inChunks, must, upsertInChunks, type PageQuery } from "./query";
import type { Db, Insert, Row } from "./db";
import type { InMemoryDataset } from "./in-memory";

/** Who may open a course and when (`course_access`): derived from purchases and grants by `/api/process/courses`. */
export type CourseAccessRecord = Row<"course_access">;
/** Where a member left off in a lesson, and whether they finished it (`lesson_progress`). */
export type LessonProgressRecord = Row<"lesson_progress">;
/** Staff-granted access (`course_access_grants`): comps and staff, written by admins, never derived. */
export type CourseGrantRecord = Row<"course_access_grants">;
export type NewCourseAccess = Insert<"course_access">;

const ID_CHUNK = 200;

/**
 * What members have done in courses and what they may open: `lesson_progress`, `course_access` (derived,
 * rebuilt by the processing run) and, later, the watch segments and staff grants. These are Local tables,
 * never reprocessed from Bronze, except `course_access`, which processing rebuilds from purchases and
 * grants. A member's client reads and writes only their own rows (row-level security); the service role
 * reads everyone's. Reads paginate past 1000 rows in a stable order, chunk id lists and throw the
 * database's message on an error.
 */
export interface CourseProgressRepository {
  /** A member's access rows, for these courses or (when `courseIds` is omitted) every course, by course id. */
  memberAccess(memberId: string, courseIds?: string[]): Promise<CourseAccessRecord[]>;
  /** Everyone's access rows to these courses, by course then member. */
  accessOfCourses(courseIds: string[]): Promise<CourseAccessRecord[]>;
  /** Which of these lessons the member has completed. */
  completedLessonIds(memberId: string, lessonIds: string[]): Promise<Set<string>>;
  /** The lessons a member left part-way (a saved position, not completed), most recently touched first, at most `limit`. */
  partlyWatched(memberId: string, limit: number): Promise<{ lesson_id: string; last_position_seconds: number }[]>;
  /** Where the member left off in a lesson, or null when there is no progress row. */
  lessonPosition(memberId: string, lessonId: string): Promise<number | null>;
  /** Whether any member has a progress row (started or completed) in any of these lessons. */
  hasProgressIn(lessonIds: string[]): Promise<boolean>;

  // --- access (derived by the processing run) ---
  /** The staff grants for these courses, by course then member. Paginated. */
  grantsOfCourses(courseIds: string[]): Promise<CourseGrantRecord[]>;
  /** Adds or updates access rows on (member, course), in chunks. */
  upsertAccess(rows: NewCourseAccess[]): Promise<void>;
  /** Removes these members' access to the course, in chunks. */
  removeAccess(courseId: string, memberIds: string[]): Promise<void>;
}

export class SupabaseCourseProgressRepository implements CourseProgressRepository {
  constructor(private readonly db: Db) {}

  async memberAccess(memberId: string, courseIds?: string[]) {
    const read = (ids?: string[]) =>
      fetchAllRows<CourseAccessRecord>((from, to) => {
        let query = this.db.from("course_access").select("*").eq("member_id", memberId);
        if (ids) query = query.in("course_id", ids);
        return query.order("course_id").range(from, to) as unknown as PageQuery<CourseAccessRecord>;
      });
    if (!courseIds) return read();
    return (await inChunks(courseIds, ID_CHUNK, (part) => read(part))).sort((a, b) => compareText(a.course_id, b.course_id));
  }

  async accessOfCourses(courseIds: string[]) {
    const rows = await inChunks(courseIds, ID_CHUNK, (part) =>
      fetchAllRows<CourseAccessRecord>(
        (from, to) => this.db.from("course_access").select("*").in("course_id", part).order("course_id").order("member_id").range(from, to) as unknown as PageQuery<CourseAccessRecord>
      )
    );
    return rows.sort((a, b) => compareText(a.course_id, b.course_id) || compareText(a.member_id, b.member_id));
  }

  async completedLessonIds(memberId: string, lessonIds: string[]) {
    const rows = await inChunks(lessonIds, ID_CHUNK, async (part) =>
      (must(await this.db.from("lesson_progress").select("lesson_id").eq("member_id", memberId).not("completed_at", "is", null).in("lesson_id", part)) ?? [])
    );
    return new Set(rows.map((r) => r.lesson_id));
  }

  async partlyWatched(memberId: string, limit: number) {
    const rows = must(
      await this.db
        .from("lesson_progress")
        .select("lesson_id, last_position_seconds")
        .eq("member_id", memberId)
        .is("completed_at", null)
        .gt("last_position_seconds", 0)
        .order("updated_at", { ascending: false })
        .order("lesson_id")
        .limit(limit)
    );
    return (rows ?? []).map((r) => ({ lesson_id: r.lesson_id, last_position_seconds: Number(r.last_position_seconds) }));
  }

  async lessonPosition(memberId: string, lessonId: string) {
    const row = must(await this.db.from("lesson_progress").select("last_position_seconds").eq("member_id", memberId).eq("lesson_id", lessonId).maybeSingle());
    return row ? Number(row.last_position_seconds) : null;
  }

  async hasProgressIn(lessonIds: string[]) {
    for (const part of chunk(lessonIds, ID_CHUNK)) {
      const { count, error } = await this.db.from("lesson_progress").select("lesson_id", { count: "exact", head: true }).in("lesson_id", part);
      if (error) throw new Error(error.message);
      if (count) return true;
    }
    return false;
  }

  async grantsOfCourses(courseIds: string[]) {
    const rows = await inChunks(courseIds, ID_CHUNK, (part) =>
      fetchAllRows<CourseGrantRecord>(
        (from, to) => this.db.from("course_access_grants").select("*").in("course_id", part).order("course_id").order("member_id").range(from, to) as unknown as PageQuery<CourseGrantRecord>
      )
    );
    return rows.sort((a, b) => compareText(a.course_id, b.course_id) || compareText(a.member_id, b.member_id));
  }

  async upsertAccess(rows: NewCourseAccess[]) {
    await upsertInChunks(this.db.from("course_access"), rows, "member_id,course_id");
  }

  async removeAccess(courseId: string, memberIds: string[]) {
    for (const part of chunk(memberIds, ID_CHUNK)) {
      const { error } = await this.db.from("course_access").delete().eq("course_id", courseId).in("member_id", part);
      if (error) throw new Error(error.message);
    }
  }
}

const copy = <T extends object>(row: T): T => ({ ...row });

/** In-memory twin over an `InMemoryDataset`. */
export class InMemoryCourseProgressRepository implements CourseProgressRepository {
  constructor(private readonly data: InMemoryDataset) {}

  async memberAccess(memberId: string, courseIds?: string[]) {
    const wanted = courseIds ? new Set(courseIds) : null;
    return this.data.courseAccess
      .filter((a) => a.member_id === memberId && (!wanted || wanted.has(a.course_id)))
      .map(copy)
      .sort((a, b) => compareText(a.course_id, b.course_id));
  }

  async accessOfCourses(courseIds: string[]) {
    const wanted = new Set(courseIds);
    return this.data.courseAccess
      .filter((a) => wanted.has(a.course_id))
      .map(copy)
      .sort((a, b) => compareText(a.course_id, b.course_id) || compareText(a.member_id, b.member_id));
  }

  async completedLessonIds(memberId: string, lessonIds: string[]) {
    const wanted = new Set(lessonIds);
    return new Set(this.data.lessonProgress.filter((p) => p.member_id === memberId && p.completed_at !== null && wanted.has(p.lesson_id)).map((p) => p.lesson_id));
  }

  async partlyWatched(memberId: string, limit: number) {
    return this.data.lessonProgress
      .filter((p) => p.member_id === memberId && p.completed_at === null && Number(p.last_position_seconds) > 0)
      .sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at) || compareText(a.lesson_id, b.lesson_id))
      .slice(0, limit)
      .map((p) => ({ lesson_id: p.lesson_id, last_position_seconds: Number(p.last_position_seconds) }));
  }

  async lessonPosition(memberId: string, lessonId: string) {
    const row = this.data.lessonProgress.find((p) => p.member_id === memberId && p.lesson_id === lessonId);
    return row ? Number(row.last_position_seconds) : null;
  }

  async hasProgressIn(lessonIds: string[]) {
    const wanted = new Set(lessonIds);
    return this.data.lessonProgress.some((p) => wanted.has(p.lesson_id));
  }

  async grantsOfCourses(courseIds: string[]) {
    const wanted = new Set(courseIds);
    return this.data.courseAccessGrants
      .filter((g) => wanted.has(g.course_id))
      .map(copy)
      .sort((a, b) => compareText(a.course_id, b.course_id) || compareText(a.member_id, b.member_id));
  }

  async upsertAccess(rows: NewCourseAccess[]) {
    for (const row of rows) {
      const existing = this.data.courseAccess.find((a) => a.member_id === row.member_id && a.course_id === row.course_id);
      if (existing) Object.assign(existing, { ends_at: null, ...row });
      else this.data.courseAccess.push({ ends_at: null, ...row });
    }
  }

  async removeAccess(courseId: string, memberIds: string[]) {
    const gone = new Set(memberIds);
    this.data.courseAccess = this.data.courseAccess.filter((a) => !(a.course_id === courseId && gone.has(a.member_id)));
  }
}
