import { randomInt } from "node:crypto";
import { fetchAllRows } from "@/lib/supabase/paginate";
import { byKeyThenId, compareText, inChunks, must, type PageQuery } from "./query";
import type { Db, Row } from "./db";
import type { InMemoryDataset } from "./in-memory";

/** A course (`courses`): imported from Kajabi (`source = 'kajabi'`, a draft until published) or owned by the Hub (`source = 'hub'`). */
export type CourseRecord = Row<"courses">;
export type ModuleRecord = Row<"course_modules">;
/** A lesson without its text (`body_html` is large: `lessonBody` reads it for the one lesson that needs it). */
export type LessonRecord = Omit<Row<"course_lessons">, "body_html">;
export type LessonFileRecord = Row<"course_lesson_files">;
export type VideoRecord = Row<"videos">;

/** Which courses to read: a course's origin, whether it is a draft, and a set of ids. Omitted = no restriction. */
export type CourseFilter = { source?: string; isDraft?: boolean; ids?: string[] };
/** Which modules or lessons to read: hidden ones (Kajabi drafts) only when asked, and one origin only when given. */
export type StructureFilter = { includeHidden?: boolean; source?: string };

const ID_CHUNK = 200;
const LESSON_COLUMNS =
  "id, course_id, module_id, title, position, state, excerpt, duration_seconds, video_id, thumbnail_url, thumbnail_asset_id, thumbnail_source, source, source_key, created_at, updated_at" as const;

/**
 * Courses, their modules and lessons, lesson downloads and the Mux videos (`courses`, `course_modules`,
 * `course_lessons`, `course_lesson_files`, `videos`). The curriculum is Silver: Kajabi-sourced rows are
 * upserted on their source key with orphans removed by `/api/process/courses`, Hub-sourced rows are
 * written by the course editor and never reprocessed; `videos` is Local. Reads paginate past 1000 rows in
 * a stable order (id), chunk id lists, and throw the database's message on an error. A lookup that finds
 * no row returns null: the caller picks the user-facing message. Which rows a caller may read is the
 * client's: a member's client runs under row-level security, the service role sees everything.
 */
export interface CourseRepository {
  // --- courses ---
  courseById(id: string): Promise<CourseRecord | null>;
  /** A course by its address; `isDraft` / `source` narrow it (a member's lookup passes `isDraft: false`). */
  courseBySlug(slug: string, filter?: { source?: string; isDraft?: boolean }): Promise<CourseRecord | null>;
  /** Courses matching the filter, by slug. Paginated; `ids` chunked. */
  courses(filter?: CourseFilter): Promise<CourseRecord[]>;

  // --- modules and lessons ---
  /** The modules of these courses, by id. Hidden ones (Kajabi drafts) are left out unless `includeHidden`. */
  modulesOf(courseIds: string[], filter?: StructureFilter): Promise<ModuleRecord[]>;
  /** The lessons of these courses (no text), by id. Hidden ones are left out unless `includeHidden`. */
  lessonsOf(courseIds: string[], filter?: StructureFilter): Promise<LessonRecord[]>;
  lessonById(id: string): Promise<LessonRecord | null>;
  /** A lesson's text and video link, or null for an unknown id. */
  lessonBody(id: string): Promise<{ body_html: string | null; video_id: string | null } | null>;
  /** The lessons among these ids that are open (not "coming soon", not hidden). */
  openLessons(ids: string[]): Promise<LessonRecord[]>;

  // --- downloads and videos ---
  /** A lesson's downloads in order. */
  lessonFiles(lessonId: string): Promise<LessonFileRecord[]>;
  /** One download of a lesson, or null. */
  lessonFile(lessonId: string, fileId: string): Promise<LessonFileRecord | null>;
  video(id: string): Promise<VideoRecord | null>;
}

export class SupabaseCourseRepository implements CourseRepository {
  constructor(private readonly db: Db) {}

  async courseById(id: string) {
    return must(await this.db.from("courses").select("*").eq("id", id).maybeSingle());
  }

  async courseBySlug(slug: string, filter: { source?: string; isDraft?: boolean } = {}) {
    let query = this.db.from("courses").select("*").eq("slug", slug);
    if (filter.source !== undefined) query = query.eq("source", filter.source);
    if (filter.isDraft !== undefined) query = query.eq("is_draft", filter.isDraft);
    return must(await query.maybeSingle());
  }

  async courses(filter: CourseFilter = {}) {
    const read = (ids?: string[]) =>
      fetchAllRows<CourseRecord>((from, to) => {
        let query = this.db.from("courses").select("*");
        if (filter.source !== undefined) query = query.eq("source", filter.source);
        if (filter.isDraft !== undefined) query = query.eq("is_draft", filter.isDraft);
        if (ids) query = query.in("id", ids);
        return query.order("slug").order("id").range(from, to) as unknown as PageQuery<CourseRecord>;
      });
    if (!filter.ids) return read();
    const rows = await inChunks(filter.ids, ID_CHUNK, (part) => read(part));
    return rows.sort(byKeyThenId((c) => c.slug, (c) => c.id));
  }

  async modulesOf(courseIds: string[], filter: StructureFilter = {}) {
    const rows = await inChunks(courseIds, ID_CHUNK, (part) =>
      fetchAllRows<ModuleRecord>((from, to) => {
        let query = this.db.from("course_modules").select("*").in("course_id", part);
        if (!filter.includeHidden) query = query.neq("state", "hidden");
        if (filter.source !== undefined) query = query.eq("source", filter.source);
        return query.order("id").range(from, to) as unknown as PageQuery<ModuleRecord>;
      })
    );
    return rows.sort((a, b) => compareText(a.id, b.id));
  }

  async lessonsOf(courseIds: string[], filter: StructureFilter = {}) {
    const rows = await inChunks(courseIds, ID_CHUNK, (part) =>
      fetchAllRows<LessonRecord>((from, to) => {
        let query = this.db.from("course_lessons").select(LESSON_COLUMNS).in("course_id", part);
        if (!filter.includeHidden) query = query.neq("state", "hidden");
        if (filter.source !== undefined) query = query.eq("source", filter.source);
        return query.order("id").range(from, to) as unknown as PageQuery<LessonRecord>;
      })
    );
    return rows.sort((a, b) => compareText(a.id, b.id));
  }

  async lessonById(id: string) {
    return must(await this.db.from("course_lessons").select(LESSON_COLUMNS).eq("id", id).maybeSingle()) as LessonRecord | null;
  }

  async lessonBody(id: string) {
    return must(await this.db.from("course_lessons").select("body_html, video_id").eq("id", id).maybeSingle());
  }

  async openLessons(ids: string[]) {
    const rows = await inChunks(ids, ID_CHUNK, async (part) =>
      must(await this.db.from("course_lessons").select(LESSON_COLUMNS).eq("state", "open").in("id", part)) as LessonRecord[]
    );
    return rows.sort((a, b) => compareText(a.id, b.id));
  }

  async lessonFiles(lessonId: string) {
    return must(await this.db.from("course_lesson_files").select("*").eq("lesson_id", lessonId).order("position").order("id")) ?? [];
  }

  async lessonFile(lessonId: string, fileId: string) {
    return must(await this.db.from("course_lesson_files").select("*").eq("id", fileId).eq("lesson_id", lessonId).maybeSingle());
  }

  async video(id: string) {
    return must(await this.db.from("videos").select("*").eq("id", id).maybeSingle());
  }
}

const BASE58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
/** An id like the database's `new_id(prefix)`, for rows the in-memory twin creates. */
export const newCourseId = (prefix: string) => `${prefix}_${Array.from({ length: 12 }, () => BASE58[randomInt(BASE58.length)]).join("")}`;

const copy = <T extends object>(row: T): T => ({ ...row });
const withoutBody = ({ body_html: _body, ...rest }: Row<"course_lessons">): LessonRecord => rest;

/** In-memory twin over an `InMemoryDataset`. */
export class InMemoryCourseRepository implements CourseRepository {
  constructor(private readonly data: InMemoryDataset) {}

  async courseById(id: string) {
    const course = this.data.courses.find((c) => c.id === id);
    return course ? copy(course) : null;
  }

  async courseBySlug(slug: string, filter: { source?: string; isDraft?: boolean } = {}) {
    const course = this.data.courses.find(
      (c) => c.slug === slug && (filter.source === undefined || c.source === filter.source) && (filter.isDraft === undefined || c.is_draft === filter.isDraft)
    );
    return course ? copy(course) : null;
  }

  async courses(filter: CourseFilter = {}) {
    const ids = filter.ids ? new Set(filter.ids) : null;
    return this.data.courses
      .filter((c) => (filter.source === undefined || c.source === filter.source) && (filter.isDraft === undefined || c.is_draft === filter.isDraft) && (!ids || ids.has(c.id)))
      .map(copy)
      .sort(byKeyThenId((c) => c.slug, (c) => c.id));
  }

  async modulesOf(courseIds: string[], filter: StructureFilter = {}) {
    const wanted = new Set(courseIds);
    return this.data.courseModules
      .filter((m) => wanted.has(m.course_id) && (filter.includeHidden || m.state !== "hidden") && (filter.source === undefined || m.source === filter.source))
      .map(copy)
      .sort((a, b) => compareText(a.id, b.id));
  }

  async lessonsOf(courseIds: string[], filter: StructureFilter = {}) {
    const wanted = new Set(courseIds);
    return this.data.courseLessons
      .filter((l) => wanted.has(l.course_id) && (filter.includeHidden || l.state !== "hidden") && (filter.source === undefined || l.source === filter.source))
      .map((l) => withoutBody(l))
      .sort((a, b) => compareText(a.id, b.id));
  }

  async lessonById(id: string) {
    const lesson = this.data.courseLessons.find((l) => l.id === id);
    return lesson ? withoutBody(lesson) : null;
  }

  async lessonBody(id: string) {
    const lesson = this.data.courseLessons.find((l) => l.id === id);
    return lesson ? { body_html: lesson.body_html, video_id: lesson.video_id } : null;
  }

  async openLessons(ids: string[]) {
    const wanted = new Set(ids);
    return this.data.courseLessons
      .filter((l) => wanted.has(l.id) && l.state === "open")
      .map((l) => withoutBody(l))
      .sort((a, b) => compareText(a.id, b.id));
  }

  async lessonFiles(lessonId: string) {
    return this.data.courseLessonFiles
      .filter((f) => f.lesson_id === lessonId)
      .map(copy)
      .sort((a, b) => a.position - b.position || compareText(a.id, b.id));
  }

  async lessonFile(lessonId: string, fileId: string) {
    const file = this.data.courseLessonFiles.find((f) => f.id === fileId && f.lesson_id === lessonId);
    return file ? copy(file) : null;
  }

  async video(id: string) {
    const video = this.data.videos.find((v) => v.id === id);
    return video ? copy(video) : null;
  }
}
