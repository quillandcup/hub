import { chunk, fetchAllRows } from "@/lib/supabase/paginate";
import { compareText, inChunks, must, upsertInChunks } from "./query";
import type { Db, Insert, Row } from "./db";
import type { InMemoryDataset } from "./in-memory";

/** Who may open a course and when (`course_access`): derived from purchases and grants by `/api/process/courses`. */
export type CourseAccessRecord = Row<"course_access">;
/** Where a member left off in a lesson, and whether they finished it (`lesson_progress`). */
export type LessonProgressRecord = Row<"lesson_progress">;
/** Staff-granted access (`course_access_grants`): comps and staff, written by admins, never derived. */
export type CourseGrantRecord = Row<"course_access_grants">;
export type NewCourseAccess = Insert<"course_access">;
export type NewLessonProgress = Insert<"lesson_progress">;
/** One continuous stretch of a video a member watched, or the marker that the player appeared (`kind = 'viewed'`): append-only. */
export type WatchSegmentRecord = Row<"video_watch_segments">;
export type NewWatchSegment = Insert<"video_watch_segments">;

const ID_CHUNK = 200;
const WRITE_CHUNK = 500;

/**
 * What members have done in courses and what they may open: `lesson_progress`, `video_watch_segments`
 * (append-only), `course_access` (derived, rebuilt by the processing run) and the staff grants. These are
 * Local tables, never reprocessed from Bronze, except `course_access`, which processing rebuilds from
 * purchases and grants. A member's client reads and writes only their own rows (row-level security); the service role
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

  /** Everyone's progress rows in these lessons, by member then lesson. Paginated. */
  progressOfLessons(lessonIds: string[]): Promise<LessonProgressRecord[]>;
  /** Adds progress rows for (member, lesson) pairs that have none; a row that exists is never changed. */
  insertProgressIfAbsent(rows: NewLessonProgress[]): Promise<void>;
  /** Marks a lesson complete (`completedAt`) or not (null) for the member, keeping where they left off; creates the row when there is none. */
  setCompletion(memberId: string, lessonId: string, completedAt: string | null): Promise<void>;
  /** Saves where the member left off in a lesson, keeping whether it is complete; creates the row when there is none. */
  savePosition(memberId: string, lessonId: string, seconds: number): Promise<void>;
  /** Removes the member's progress row for a lesson (position and completion). */
  clearProgress(memberId: string, lessonId: string): Promise<void>;

  // --- watching ---
  /** The stretches the member watched of a video that started at or after `since`, by start time. Paginated. */
  watchedSince(memberId: string, videoId: string, since: string): Promise<{ start_seconds: number; end_seconds: number; started_at: string }[]>;
  /** Every segment and view marker of these videos (every member's), by id. Paginated, chunked. */
  segmentsOfVideos(videoIds: string[]): Promise<WatchSegmentRecord[]>;
  /** Saves segments or view markers; one the member already sent (same client segment id) is skipped. Returns how many were new. */
  saveSegments(rows: NewWatchSegment[]): Promise<number>;
  /** Removes the member's segments and markers of a video; returns how many there were. */
  clearSegments(memberId: string, videoId: string): Promise<number>;

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
        return query.order("course_id").range(from, to);
      });
    if (!courseIds) return read();
    return (await inChunks(courseIds, ID_CHUNK, (part) => read(part))).sort((a, b) => compareText(a.course_id, b.course_id));
  }

  async accessOfCourses(courseIds: string[]) {
    const rows = await inChunks(courseIds, ID_CHUNK, (part) =>
      fetchAllRows<CourseAccessRecord>(
        (from, to) => this.db.from("course_access").select("*").in("course_id", part).order("course_id").order("member_id").range(from, to)
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
        (from, to) => this.db.from("course_access_grants").select("*").in("course_id", part).order("course_id").order("member_id").range(from, to)
      )
    );
    return rows.sort((a, b) => compareText(a.course_id, b.course_id) || compareText(a.member_id, b.member_id));
  }

  async progressOfLessons(lessonIds: string[]) {
    const rows = await inChunks(lessonIds, ID_CHUNK, (part) =>
      fetchAllRows<LessonProgressRecord>(
        (from, to) => this.db.from("lesson_progress").select("*").in("lesson_id", part).order("member_id").order("lesson_id").range(from, to)
      )
    );
    return rows.sort((a, b) => compareText(a.member_id, b.member_id) || compareText(a.lesson_id, b.lesson_id));
  }

  async insertProgressIfAbsent(rows: NewLessonProgress[]) {
    for (const part of chunk(rows, WRITE_CHUNK)) {
      // ON CONFLICT DO NOTHING: a row the member made since the caller looked is never overwritten.
      const { error } = await this.db.from("lesson_progress").upsert(part, { onConflict: "member_id,lesson_id", ignoreDuplicates: true });
      if (error) throw new Error(error.message);
    }
  }

  async setCompletion(memberId: string, lessonId: string, completedAt: string | null) {
    // An upsert writes only the columns it is given, so the saved position is left alone.
    const { error } = await this.db.from("lesson_progress").upsert({ member_id: memberId, lesson_id: lessonId, completed_at: completedAt }, { onConflict: "member_id,lesson_id" });
    if (error) throw new Error(error.message);
  }

  async savePosition(memberId: string, lessonId: string, seconds: number) {
    // Only the position: completed_at is left alone.
    const { error } = await this.db.from("lesson_progress").upsert({ member_id: memberId, lesson_id: lessonId, last_position_seconds: seconds }, { onConflict: "member_id,lesson_id" });
    if (error) throw new Error(error.message);
  }

  async clearProgress(memberId: string, lessonId: string) {
    const { error } = await this.db.from("lesson_progress").delete().eq("member_id", memberId).eq("lesson_id", lessonId);
    if (error) throw new Error(error.message);
  }

  async watchedSince(memberId: string, videoId: string, since: string) {
    return fetchAllRows<{ start_seconds: number; end_seconds: number; started_at: string; id: string }>(
      (from, to) =>
        this.db
          .from("video_watch_segments")
          .select("id, start_seconds, end_seconds, started_at")
          .eq("member_id", memberId)
          .eq("video_id", videoId)
          .eq("kind", "watched")
          .gte("started_at", since)
          .order("started_at")
          .order("id")
          .range(from, to)
    ).then((rows) => rows.map(({ start_seconds, end_seconds, started_at }) => ({ start_seconds: Number(start_seconds), end_seconds: Number(end_seconds), started_at })));
  }

  async segmentsOfVideos(videoIds: string[]) {
    const rows = await inChunks(videoIds, ID_CHUNK, (part) =>
      fetchAllRows<WatchSegmentRecord>(
        (from, to) => this.db.from("video_watch_segments").select("*").in("video_id", part).order("id").range(from, to)
      )
    );
    return rows.sort((a, b) => compareText(a.id, b.id));
  }

  async saveSegments(rows: NewWatchSegment[]) {
    let saved = 0;
    for (const part of chunk(rows, WRITE_CHUNK)) {
      // Each segment carries the player's own id, so a resend of a save that already arrived is ignored.
      const { data, error } = await this.db.from("video_watch_segments").upsert(part, { onConflict: "member_id,client_segment_id", ignoreDuplicates: true }).select("id");
      if (error) throw new Error(error.message);
      saved += data?.length ?? 0;
    }
    return saved;
  }

  async clearSegments(memberId: string, videoId: string) {
    const { data, error } = await this.db.from("video_watch_segments").delete().eq("member_id", memberId).eq("video_id", videoId).select("id");
    if (error) throw new Error(error.message);
    return data?.length ?? 0;
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

  async progressOfLessons(lessonIds: string[]) {
    const wanted = new Set(lessonIds);
    return this.data.lessonProgress
      .filter((p) => wanted.has(p.lesson_id))
      .map(copy)
      .sort((a, b) => compareText(a.member_id, b.member_id) || compareText(a.lesson_id, b.lesson_id));
  }

  private progressRow(memberId: string, lessonId: string) {
    return this.data.lessonProgress.find((p) => p.member_id === memberId && p.lesson_id === lessonId);
  }

  private newProgress(row: NewLessonProgress): LessonProgressRecord {
    const stamp = new Date().toISOString();
    return { completed_at: null, created_at: stamp, imported_from: null, last_position_seconds: 0, updated_at: stamp, ...row };
  }

  async insertProgressIfAbsent(rows: NewLessonProgress[]) {
    for (const row of rows) if (!this.progressRow(row.member_id, row.lesson_id)) this.data.lessonProgress.push(this.newProgress(row));
  }

  async setCompletion(memberId: string, lessonId: string, completedAt: string | null) {
    const existing = this.progressRow(memberId, lessonId);
    if (!existing) return void this.data.lessonProgress.push(this.newProgress({ member_id: memberId, lesson_id: lessonId, completed_at: completedAt }));
    existing.completed_at = completedAt;
    existing.updated_at = new Date().toISOString();
  }

  async savePosition(memberId: string, lessonId: string, seconds: number) {
    const existing = this.progressRow(memberId, lessonId);
    if (!existing) return void this.data.lessonProgress.push(this.newProgress({ member_id: memberId, lesson_id: lessonId, last_position_seconds: seconds }));
    existing.last_position_seconds = seconds;
    existing.updated_at = new Date().toISOString();
  }

  async clearProgress(memberId: string, lessonId: string) {
    this.data.lessonProgress = this.data.lessonProgress.filter((p) => !(p.member_id === memberId && p.lesson_id === lessonId));
  }

  async watchedSince(memberId: string, videoId: string, since: string) {
    return this.data.videoWatchSegments
      .filter((s) => s.member_id === memberId && s.video_id === videoId && s.kind === "watched" && Date.parse(s.started_at) >= Date.parse(since))
      .sort((a, b) => Date.parse(a.started_at) - Date.parse(b.started_at) || compareText(a.id, b.id))
      .map((s) => ({ start_seconds: Number(s.start_seconds), end_seconds: Number(s.end_seconds), started_at: s.started_at }));
  }

  async segmentsOfVideos(videoIds: string[]) {
    const wanted = new Set(videoIds);
    return this.data.videoWatchSegments
      .filter((s) => wanted.has(s.video_id))
      .map(copy)
      .sort((a, b) => compareText(a.id, b.id));
  }

  async saveSegments(rows: NewWatchSegment[]) {
    let saved = 0;
    for (const row of rows) {
      const clientId = row.client_segment_id ?? null;
      if (clientId !== null && this.data.videoWatchSegments.some((s) => s.member_id === row.member_id && s.client_segment_id === clientId)) continue;
      this.data.videoWatchSegments.push({
        id: crypto.randomUUID(),
        captions_language: null,
        client_segment_id: null,
        device: null,
        kind: "watched",
        playback_rate: 1,
        started_at: new Date().toISOString(),
        user_agent: null,
        visible: true,
        ...(Object.fromEntries(Object.entries(row).filter(([, v]) => v !== undefined)) as NewWatchSegment),
      } as WatchSegmentRecord);
      saved++;
    }
    return saved;
  }

  async clearSegments(memberId: string, videoId: string) {
    const before = this.data.videoWatchSegments.length;
    this.data.videoWatchSegments = this.data.videoWatchSegments.filter((s) => !(s.member_id === memberId && s.video_id === videoId));
    return before - this.data.videoWatchSegments.length;
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
