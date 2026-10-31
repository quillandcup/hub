import { randomInt } from "node:crypto";
import { chunk, fetchAllRows } from "@/lib/supabase/paginate";
import { byKeyThenId, compareText, inChunks, must, upsertInChunks, type PageQuery } from "./query";
import type { Db, Insert, Row, Update } from "./db";
import type { InMemoryDataset } from "./in-memory";

/** A course (`courses`): imported from Kajabi (`source = 'kajabi'`, a draft until published) or owned by the Hub (`source = 'hub'`). */
export type CourseRecord = Row<"courses">;
export type ModuleRecord = Row<"course_modules">;
/** A lesson without its text (`body_html` is large: `lessonBody` reads it for the one lesson that needs it). */
export type LessonRecord = Omit<Row<"course_lessons">, "body_html">;
export type LessonFileRecord = Row<"course_lesson_files">;
export type VideoRecord = Row<"videos">;

export type NewCourse = Insert<"courses">;
export type CoursePatch = Update<"courses">;
export type NewModule = Insert<"course_modules">;
export type NewLesson = Insert<"course_lessons">;
export type NewLessonFile = Insert<"course_lesson_files">;
export type NewVideo = Insert<"videos">;
export type VideoPatch = Update<"videos">;

/** Which courses to read: a course's origin, whether it is a draft, and a set of ids. Omitted = no restriction. */
export type CourseFilter = { source?: string; isDraft?: boolean; ids?: string[] };
/** Which modules or lessons to read: hidden ones (Kajabi drafts) only when asked, and one origin only when given. */
export type StructureFilter = { includeHidden?: boolean; source?: string };
/** The four places a course shows a picture: its cover, its banner, a module's poster and a lesson's thumbnail. */
export type CourseImageKind = "course" | "hero" | "module" | "lesson";
/** The outline's two kinds of item. */
export type OutlineKind = "module" | "lesson";

/** A refused write, with the database's error code (23505 unique, 23503 foreign key, 42501 policy) for callers that tell the person why. */
export class CourseWriteError extends Error {
  constructor(
    message: string,
    readonly code?: string
  ) {
    super(message);
    this.name = "CourseWriteError";
  }
}
const writeError = (error: { message: string; code?: string }) => new CourseWriteError(error.message, error.code);

const ID_CHUNK = 200;
const WRITE_CHUNK = 500;
const LESSON_COLUMNS =
  "id, course_id, module_id, title, position, state, excerpt, duration_seconds, video_id, thumbnail_url, thumbnail_asset_id, thumbnail_source, source, source_key, created_at, updated_at" as const;

/**
 * Courses, their modules and lessons, lesson downloads and the Mux videos (`courses`, `course_modules`,
 * `course_lessons`, `course_lesson_files`, `videos`). The curriculum is Silver: Kajabi-sourced rows are
 * upserted on their source key with orphans removed by `/api/process/courses`, Hub-sourced rows are
 * written by the course editor and never reprocessed; `videos` is Local. Reads paginate past 1000 rows in
 * a stable order (id), chunk id lists, and throw the database's message on an error. A lookup that finds
 * no row returns null: the caller picks the user-facing message. Which rows a caller may read or write is
 * the client's: a member's or admin's client runs under row-level security, the service role sees everything.
 */
export interface CourseRepository {
  // --- courses ---
  courseById(id: string): Promise<CourseRecord | null>;
  /** A course by its address; `isDraft` / `source` narrow it (a member's lookup passes `isDraft: false`). */
  courseBySlug(slug: string, filter?: { source?: string; isDraft?: boolean }): Promise<CourseRecord | null>;
  /** A course by where it came from (a Kajabi course by its Kajabi id), or null. */
  courseBySource(source: string, sourceKey: string): Promise<CourseRecord | null>;
  /** Courses matching the filter, by slug. Paginated; `ids` chunked. */
  courses(filter?: CourseFilter): Promise<CourseRecord[]>;
  /** Adds a course and returns it. Throws a {@link CourseWriteError} (23505 when the address is taken). */
  createCourse(course: NewCourse): Promise<CourseRecord>;
  /** Adds courses, in chunks. */
  createCourses(courses: NewCourse[]): Promise<void>;
  /** Changes a course and returns it, or null when no course matches (`only.source` narrows the match). Throws a {@link CourseWriteError} (23505 when the address is taken). */
  updateCourse(id: string, patch: CoursePatch, only?: { source?: string }): Promise<CourseRecord | null>;

  // --- modules and lessons ---
  moduleById(id: string): Promise<ModuleRecord | null>;
  /** The modules of these courses, by id. Hidden ones (Kajabi drafts) are left out unless `includeHidden`. */
  modulesOf(courseIds: string[], filter?: StructureFilter): Promise<ModuleRecord[]>;
  /** The lessons of these courses (no text), by id. Hidden ones are left out unless `includeHidden`. */
  lessonsOf(courseIds: string[], filter?: StructureFilter): Promise<LessonRecord[]>;
  lessonById(id: string): Promise<LessonRecord | null>;
  /** A lesson's text and video link, or null for an unknown id. */
  lessonBody(id: string): Promise<{ body_html: string | null; video_id: string | null } | null>;
  /** The lessons among these ids that are open (not "coming soon", not hidden). */
  openLessons(ids: string[]): Promise<LessonRecord[]>;
  /** Adds or updates modules on (source, source key), in chunks; a column the row leaves out keeps its value. Returns each source key's module id. */
  upsertModules(rows: NewModule[]): Promise<Map<string, string>>;
  /** Adds or updates lessons on (source, source key), in chunks; a column the row leaves out keeps its value. Returns each source key's lesson id. */
  upsertLessons(rows: NewLesson[]): Promise<Map<string, string>>;
  /** Removes modules (their submodules and lessons go with them), in chunks small enough for the URL. */
  deleteModules(ids: string[]): Promise<void>;
  /** Removes lessons (their downloads and members' progress go with them), in chunks. */
  deleteLessons(ids: string[]): Promise<void>;

  // --- the editor's outline writes (Hub-owned courses) ---
  /** The position after the last sibling: of a course's modules under `parentId` (null = top level) or of the lessons in a module (null = in no module). */
  nextPosition(kind: OutlineKind, courseId: string, parentId: string | null): Promise<number>;
  /** Adds a module and returns its id. Throws a {@link CourseWriteError}. */
  addModule(mod: NewModule): Promise<string>;
  /** Adds a lesson and returns its id. Throws a {@link CourseWriteError}. */
  addLesson(lesson: NewLesson): Promise<string>;
  /** Renames a Hub-owned module or lesson of the course. False when none matches. */
  renameItem(kind: OutlineKind, target: { id: string; courseId: string }, title: string): Promise<boolean>;
  /** The lessons of a module and its submodules, or the one lesson. */
  lessonIdsUnder(kind: OutlineKind, id: string): Promise<string[]>;
  /** Deletes a Hub-owned module or lesson of the course. False when none matches. */
  deleteItem(kind: OutlineKind, target: { id: string; courseId: string }): Promise<boolean>;
  /** A draft copy of the module (with its submodules and lessons) or lesson, at the end of its siblings; returns the copy's id. Throws a {@link CourseWriteError} (`not_found`). */
  duplicateItem(kind: OutlineKind, id: string): Promise<string>;
  /** Puts the children of one parent in this order, all or nothing. The list must be exactly the current children. Throws a {@link CourseWriteError} (`stale_order`, `not_editable`). */
  reorderChildren(order: { courseId: string; kind: OutlineKind; parentId: string | null; ids: string[] }): Promise<void>;

  // --- images ---
  /** The library image a course, banner, module or lesson shows, and the item's state (modules and lessons), or null when the item is missing. */
  imageOf(kind: CourseImageKind, id: string): Promise<{ assetId: string | null; state: string | null } | null>;
  /** Records the library image (and the link it was copied from) an item shows; null clears both. */
  setImage(kind: CourseImageKind, id: string, image: { asset: string | null; source: string | null }): Promise<void>;

  // --- downloads and videos ---
  /** A lesson's downloads in order. */
  lessonFiles(lessonId: string): Promise<LessonFileRecord[]>;
  /** The downloads of these lessons, by id. Paginated. */
  filesOfLessons(lessonIds: string[]): Promise<LessonFileRecord[]>;
  /** One download of a lesson, or null. */
  lessonFile(lessonId: string, fileId: string): Promise<LessonFileRecord | null>;
  /** Adds a download or updates the one with the same source key. */
  saveLessonFile(file: NewLessonFile): Promise<void>;
  deleteLessonFile(id: string): Promise<void>;
  video(id: string): Promise<VideoRecord | null>;
  /** The videos of one kind (`kajabi`, `upload`) with these source keys, in chunks. */
  videosBySourceKeys(kind: string, keys: string[]): Promise<VideoRecord[]>;
  /** Adds a video and returns its id. */
  createVideo(video: NewVideo): Promise<string>;
  updateVideo(id: string, patch: VideoPatch): Promise<void>;
  /** The videos still "preparing" that have a Mux asset, by id. */
  preparingVideos(): Promise<{ id: string; mux_asset_id: string }[]>;
  /** Updates the video of a Mux asset and returns how many rows that was (0 = no video has that asset yet). */
  updateVideosByAsset(assetId: string, patch: VideoPatch): Promise<number>;
}

const IMAGE_COLUMNS = {
  course: { asset: "thumbnail_asset_id", source: "thumbnail_source" },
  hero: { asset: "hero_asset_id", source: "hero_source" },
  module: { asset: "poster_asset_id", source: "poster_source" },
  lesson: { asset: "thumbnail_asset_id", source: "thumbnail_source" },
} as const;

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

  async courseBySource(source: string, sourceKey: string) {
    return must(await this.db.from("courses").select("*").eq("source", source).eq("source_key", sourceKey).maybeSingle());
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

  async createCourse(course: NewCourse) {
    const { data, error } = await this.db.from("courses").insert(course).select("*").single();
    if (error) throw writeError(error);
    return data;
  }

  async createCourses(courses: NewCourse[]) {
    for (const part of chunk(courses, WRITE_CHUNK)) {
      const { error } = await this.db.from("courses").insert(part);
      if (error) throw writeError(error);
    }
  }

  async updateCourse(id: string, patch: CoursePatch, only: { source?: string } = {}) {
    let query = this.db.from("courses").update(patch).eq("id", id);
    if (only.source !== undefined) query = query.eq("source", only.source);
    const { data, error } = await query.select("*");
    if (error) throw writeError(error);
    return data?.[0] ?? null;
  }

  async moduleById(id: string) {
    return must(await this.db.from("course_modules").select("*").eq("id", id).maybeSingle());
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
      (must(await this.db.from("course_lessons").select(LESSON_COLUMNS).eq("state", "open").in("id", part)) ?? []) as LessonRecord[]
    );
    return rows.sort((a, b) => compareText(a.id, b.id));
  }

  async upsertModules(rows: NewModule[]) {
    const ids = new Map<string, string>();
    for (const part of chunk(rows, WRITE_CHUNK)) {
      const { data, error } = await this.db.from("course_modules").upsert(part, { onConflict: "source,source_key" }).select("id, source_key");
      if (error) throw new Error(error.message);
      for (const r of data ?? []) if (r.source_key) ids.set(r.source_key, r.id);
    }
    return ids;
  }

  async upsertLessons(rows: NewLesson[]) {
    const ids = new Map<string, string>();
    for (const part of chunk(rows, WRITE_CHUNK)) {
      const { data, error } = await this.db.from("course_lessons").upsert(part, { onConflict: "source,source_key" }).select("id, source_key");
      if (error) throw new Error(error.message);
      for (const r of data ?? []) if (r.source_key) ids.set(r.source_key, r.id);
    }
    return ids;
  }

  async deleteModules(ids: string[]) {
    for (const part of chunk(ids, ID_CHUNK)) {
      const { error } = await this.db.from("course_modules").delete().in("id", part);
      if (error) throw new Error(error.message);
    }
  }

  async deleteLessons(ids: string[]) {
    for (const part of chunk(ids, ID_CHUNK)) {
      const { error } = await this.db.from("course_lessons").delete().in("id", part);
      if (error) throw new Error(error.message);
    }
  }

  async nextPosition(kind: OutlineKind, courseId: string, parentId: string | null) {
    if (kind === "module") {
      const query = this.db.from("course_modules").select("position").eq("course_id", courseId);
      const rows = must(await (parentId ? query.eq("parent_id", parentId) : query.is("parent_id", null)).order("position", { ascending: false }).limit(1));
      return (rows?.[0]?.position ?? 0) + 1;
    }
    const query = this.db.from("course_lessons").select("position").eq("course_id", courseId);
    const rows = must(await (parentId ? query.eq("module_id", parentId) : query.is("module_id", null)).order("position", { ascending: false }).limit(1));
    return (rows?.[0]?.position ?? 0) + 1;
  }

  async addModule(mod: NewModule) {
    const { data, error } = await this.db.from("course_modules").insert(mod).select("id").single();
    if (error) throw writeError(error);
    return data.id;
  }

  async addLesson(lesson: NewLesson) {
    const { data, error } = await this.db.from("course_lessons").insert(lesson).select("id").single();
    if (error) throw writeError(error);
    return data.id;
  }

  async renameItem(kind: OutlineKind, target: { id: string; courseId: string }, title: string) {
    const table = kind === "module" ? "course_modules" : "course_lessons";
    const { data, error } = await this.db.from(table).update({ title }).eq("id", target.id).eq("course_id", target.courseId).eq("source", "hub").select("id");
    if (error) throw writeError(error);
    return (data ?? []).length > 0;
  }

  async lessonIdsUnder(kind: OutlineKind, id: string) {
    if (kind === "lesson") return [id];
    const children = must(await this.db.from("course_modules").select("id").eq("parent_id", id)) ?? [];
    const moduleIds = [id, ...children.map((c) => c.id)];
    const lessons = must(await this.db.from("course_lessons").select("id").in("module_id", moduleIds)) ?? [];
    return lessons.map((l) => l.id);
  }

  async deleteItem(kind: OutlineKind, target: { id: string; courseId: string }) {
    const table = kind === "module" ? "course_modules" : "course_lessons";
    const { data, error } = await this.db.from(table).delete().eq("id", target.id).eq("course_id", target.courseId).eq("source", "hub").select("id");
    if (error) throw writeError(error);
    return (data ?? []).length > 0;
  }

  async duplicateItem(kind: OutlineKind, id: string) {
    const { data, error } = kind === "module" ? await this.db.rpc("duplicate_course_module", { p_module_id: id }) : await this.db.rpc("duplicate_course_lesson", { p_lesson_id: id });
    if (error) throw writeError(error);
    return data as string;
  }

  async reorderChildren(order: { courseId: string; kind: OutlineKind; parentId: string | null; ids: string[] }) {
    const { error } = await this.db.rpc("reorder_course_children", { p_course_id: order.courseId, p_kind: order.kind, p_parent_id: order.parentId as string, p_ids: order.ids });
    if (error) throw writeError(error);
  }

  async imageOf(kind: CourseImageKind, id: string) {
    const columns = IMAGE_COLUMNS[kind];
    if (kind === "course" || kind === "hero") {
      const course = await this.courseById(id);
      return course ? { assetId: course[columns.asset as "thumbnail_asset_id" | "hero_asset_id"], state: null } : null;
    }
    if (kind === "module") {
      const mod = await this.moduleById(id);
      return mod ? { assetId: mod.poster_asset_id, state: mod.state } : null;
    }
    const lesson = await this.lessonById(id);
    return lesson ? { assetId: lesson.thumbnail_asset_id, state: lesson.state } : null;
  }

  async setImage(kind: CourseImageKind, id: string, image: { asset: string | null; source: string | null }) {
    const columns = IMAGE_COLUMNS[kind];
    const table = kind === "course" || kind === "hero" ? "courses" : kind === "module" ? "course_modules" : "course_lessons";
    const { error } = await this.db.from(table).update({ [columns.asset]: image.asset, [columns.source]: image.source } as never).eq("id", id);
    if (error) throw new Error(error.message);
  }

  async lessonFiles(lessonId: string) {
    return must(await this.db.from("course_lesson_files").select("*").eq("lesson_id", lessonId).order("position").order("id")) ?? [];
  }

  async filesOfLessons(lessonIds: string[]) {
    const rows = await inChunks(lessonIds, ID_CHUNK, (part) =>
      fetchAllRows<LessonFileRecord>(
        (from, to) => this.db.from("course_lesson_files").select("*").in("lesson_id", part).order("id").range(from, to) as unknown as PageQuery<LessonFileRecord>
      )
    );
    return rows.sort((a, b) => compareText(a.id, b.id));
  }

  async lessonFile(lessonId: string, fileId: string) {
    return must(await this.db.from("course_lesson_files").select("*").eq("id", fileId).eq("lesson_id", lessonId).maybeSingle());
  }

  async saveLessonFile(file: NewLessonFile) {
    await upsertInChunks(this.db.from("course_lesson_files"), [file], "source_key");
  }

  async deleteLessonFile(id: string) {
    const { error } = await this.db.from("course_lesson_files").delete().eq("id", id);
    if (error) throw new Error(error.message);
  }

  async video(id: string) {
    return must(await this.db.from("videos").select("*").eq("id", id).maybeSingle());
  }

  async videosBySourceKeys(kind: string, keys: string[]) {
    const rows = await inChunks(keys, ID_CHUNK, async (part) => must(await this.db.from("videos").select("*").eq("source_kind", kind).in("source_key", part)) ?? []);
    return rows.sort((a, b) => compareText(a.id, b.id));
  }

  async createVideo(video: NewVideo) {
    const { data, error } = await this.db.from("videos").insert(video).select("id").single();
    if (error) throw new Error(error.message);
    return data.id;
  }

  async updateVideo(id: string, patch: VideoPatch) {
    const { error } = await this.db.from("videos").update(patch).eq("id", id);
    if (error) throw new Error(error.message);
  }

  async preparingVideos() {
    const rows = must(await this.db.from("videos").select("id, mux_asset_id").eq("status", "preparing").not("mux_asset_id", "is", null).order("id")) ?? [];
    return rows.flatMap((r) => (r.mux_asset_id ? [{ id: r.id, mux_asset_id: r.mux_asset_id }] : []));
  }

  async updateVideosByAsset(assetId: string, patch: VideoPatch) {
    const { data, error } = await this.db.from("videos").update(patch).eq("mux_asset_id", assetId).select("id");
    if (error) throw new Error(error.message);
    return (data ?? []).length;
  }
}

const BASE58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
/** An id like the database's `new_id(prefix)`, for rows the in-memory twin creates. */
export const newCourseId = (prefix: string) => `${prefix}_${Array.from({ length: 12 }, () => BASE58[randomInt(BASE58.length)]).join("")}`;

const copy = <T extends object>(row: T): T => ({ ...row });
const withoutBody = ({ body_html: _body, ...rest }: Row<"course_lessons">): LessonRecord => rest;
const now = () => new Date().toISOString();
const unique = (message: string) => new CourseWriteError(`duplicate key value violates unique constraint: ${message}`, "23505");
/** Applies a patch the way UPDATE does: a column left out (or undefined) keeps its value. */
const apply = <T extends object>(row: T, patch: object) => {
  for (const [key, value] of Object.entries(patch)) if (value !== undefined) (row as Record<string, unknown>)[key] = value;
};

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

  async courseBySource(source: string, sourceKey: string) {
    const course = this.data.courses.find((c) => c.source === source && c.source_key === sourceKey);
    return course ? copy(course) : null;
  }

  async courses(filter: CourseFilter = {}) {
    const ids = filter.ids ? new Set(filter.ids) : null;
    return this.data.courses
      .filter((c) => (filter.source === undefined || c.source === filter.source) && (filter.isDraft === undefined || c.is_draft === filter.isDraft) && (!ids || ids.has(c.id)))
      .map(copy)
      .sort(byKeyThenId((c) => c.slug, (c) => c.id));
  }

  private insertCourse(course: NewCourse): CourseRecord {
    if (this.data.courses.some((c) => c.slug === course.slug)) throw unique("courses_slug_key");
    if (course.source_key && this.data.courses.some((c) => c.source === (course.source ?? "kajabi") && c.source_key === course.source_key)) throw unique("courses_source_source_key_key");
    const stamp = now();
    const row: CourseRecord = {
      id: newCourseId("crs"),
      access_duration: null,
      created_at: stamp,
      description: null,
      hero_asset_id: null,
      hero_source: null,
      hero_url: null,
      is_draft: false,
      kind: "evergreen",
      launch_at: null,
      program_id: null,
      source: "kajabi",
      source_key: null,
      thumbnail_asset_id: null,
      thumbnail_source: null,
      thumbnail_url: null,
      updated_at: stamp,
      ...(Object.fromEntries(Object.entries(course).filter(([, v]) => v !== undefined)) as NewCourse),
    } as CourseRecord;
    this.data.courses.push(row);
    return row;
  }

  async createCourse(course: NewCourse) {
    return copy(this.insertCourse(course));
  }

  async createCourses(courses: NewCourse[]) {
    for (const course of courses) this.insertCourse(course);
  }

  async updateCourse(id: string, patch: CoursePatch, only: { source?: string } = {}) {
    const course = this.data.courses.find((c) => c.id === id && (only.source === undefined || c.source === only.source));
    if (!course) return null;
    if (patch.slug !== undefined && this.data.courses.some((c) => c.id !== id && c.slug === patch.slug)) throw unique("courses_slug_key");
    apply(course, patch);
    course.updated_at = now();
    return copy(course);
  }

  async moduleById(id: string) {
    const mod = this.data.courseModules.find((m) => m.id === id);
    return mod ? copy(mod) : null;
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

  private newModule(mod: NewModule): Row<"course_modules"> {
    const stamp = now();
    return {
      id: newCourseId("mod"),
      parent_id: null,
      position: 0,
      poster_asset_id: null,
      poster_source: null,
      poster_url: null,
      state: "open",
      source: "kajabi",
      source_key: null,
      created_at: stamp,
      updated_at: stamp,
      ...(Object.fromEntries(Object.entries(mod).filter(([, v]) => v !== undefined)) as NewModule),
    } as Row<"course_modules">;
  }

  private newLesson(lesson: NewLesson): Row<"course_lessons"> {
    const stamp = now();
    return {
      id: newCourseId("les"),
      body_html: null,
      duration_seconds: null,
      excerpt: null,
      module_id: null,
      position: 0,
      source: "kajabi",
      source_key: null,
      state: "open",
      thumbnail_asset_id: null,
      thumbnail_source: null,
      thumbnail_url: null,
      video_id: null,
      created_at: stamp,
      updated_at: stamp,
      ...(Object.fromEntries(Object.entries(lesson).filter(([, v]) => v !== undefined)) as NewLesson),
    } as Row<"course_lessons">;
  }

  async upsertModules(rows: NewModule[]) {
    const ids = new Map<string, string>();
    for (const row of rows) {
      const source = row.source ?? "kajabi";
      const existing = this.data.courseModules.find((m) => m.source === source && m.source_key === row.source_key);
      if (existing) {
        apply(existing, row);
        existing.updated_at = now();
      } else this.data.courseModules.push(this.newModule(row));
      const stored = existing ?? this.data.courseModules[this.data.courseModules.length - 1];
      if (stored.source_key) ids.set(stored.source_key, stored.id);
    }
    return ids;
  }

  async upsertLessons(rows: NewLesson[]) {
    const ids = new Map<string, string>();
    for (const row of rows) {
      const source = row.source ?? "kajabi";
      const existing = this.data.courseLessons.find((l) => l.source === source && l.source_key === row.source_key);
      if (existing) {
        apply(existing, row);
        existing.updated_at = now();
      } else this.data.courseLessons.push(this.newLesson(row));
      const stored = existing ?? this.data.courseLessons[this.data.courseLessons.length - 1];
      if (stored.source_key) ids.set(stored.source_key, stored.id);
    }
    return ids;
  }

  /** What a deleted module takes with it: submodules (their lessons too) and its lessons. */
  private dropModules(ids: string[]) {
    const gone = new Set(ids);
    for (let grew = true; grew; ) {
      grew = false;
      for (const m of this.data.courseModules) if (m.parent_id && gone.has(m.parent_id) && !gone.has(m.id)) (gone.add(m.id), (grew = true));
    }
    this.data.courseModules = this.data.courseModules.filter((m) => !gone.has(m.id));
    this.dropLessons(this.data.courseLessons.filter((l) => l.module_id && gone.has(l.module_id)).map((l) => l.id));
  }

  private dropLessons(ids: string[]) {
    const gone = new Set(ids);
    this.data.courseLessons = this.data.courseLessons.filter((l) => !gone.has(l.id));
    this.data.courseLessonFiles = this.data.courseLessonFiles.filter((f) => !gone.has(f.lesson_id));
    this.data.lessonProgress = this.data.lessonProgress.filter((p) => !gone.has(p.lesson_id));
  }

  async deleteModules(ids: string[]) {
    this.dropModules(ids);
  }

  async deleteLessons(ids: string[]) {
    this.dropLessons(ids);
  }

  async nextPosition(kind: OutlineKind, courseId: string, parentId: string | null) {
    const siblings =
      kind === "module"
        ? this.data.courseModules.filter((m) => m.course_id === courseId && m.parent_id === parentId)
        : this.data.courseLessons.filter((l) => l.course_id === courseId && l.module_id === parentId);
    return Math.max(0, ...siblings.map((s) => s.position)) + 1;
  }

  async addModule(mod: NewModule) {
    const row = this.newModule(mod);
    this.data.courseModules.push(row);
    return row.id;
  }

  async addLesson(lesson: NewLesson) {
    const row = this.newLesson(lesson);
    this.data.courseLessons.push(row);
    return row.id;
  }

  async renameItem(kind: OutlineKind, target: { id: string; courseId: string }, title: string) {
    const rows = kind === "module" ? this.data.courseModules : this.data.courseLessons;
    const item = rows.find((r) => r.id === target.id && r.course_id === target.courseId && r.source === "hub");
    if (!item) return false;
    item.title = title;
    item.updated_at = now();
    return true;
  }

  async lessonIdsUnder(kind: OutlineKind, id: string) {
    if (kind === "lesson") return [id];
    const moduleIds = new Set([id, ...this.data.courseModules.filter((m) => m.parent_id === id).map((m) => m.id)]);
    return this.data.courseLessons.filter((l) => l.module_id && moduleIds.has(l.module_id)).map((l) => l.id);
  }

  async deleteItem(kind: OutlineKind, target: { id: string; courseId: string }) {
    const rows = kind === "module" ? this.data.courseModules : this.data.courseLessons;
    if (!rows.some((r) => r.id === target.id && r.course_id === target.courseId && r.source === "hub")) return false;
    if (kind === "module") this.dropModules([target.id]);
    else this.dropLessons([target.id]);
    return true;
  }

  async duplicateItem(kind: OutlineKind, id: string) {
    const draftLesson = (l: Row<"course_lessons">, courseId: string, moduleId: string | null, title: string, position: number): string => {
      const row = this.newLesson({
        course_id: courseId,
        module_id: moduleId,
        title,
        position,
        state: "hidden",
        body_html: l.body_html,
        excerpt: l.excerpt,
        thumbnail_url: l.thumbnail_url,
        thumbnail_source: l.thumbnail_source,
        thumbnail_asset_id: l.thumbnail_asset_id,
        video_id: l.video_id,
        duration_seconds: l.duration_seconds,
        source: "hub",
      });
      this.data.courseLessons.push(row);
      return row.id;
    };
    if (kind === "lesson") {
      const src = this.data.courseLessons.find((l) => l.id === id);
      if (!src) throw new CourseWriteError("not_found");
      return draftLesson(src, src.course_id, src.module_id, `${src.title.slice(0, 112)} (copy)`, await this.nextPosition("lesson", src.course_id, src.module_id));
    }
    const src = this.data.courseModules.find((m) => m.id === id);
    if (!src) throw new CourseWriteError("not_found");
    const draftModule = (m: Row<"course_modules">, parentId: string | null, title: string, position: number) => {
      const row = this.newModule({ course_id: m.course_id, parent_id: parentId, title, position, state: "hidden", poster_url: m.poster_url, poster_source: m.poster_source, poster_asset_id: m.poster_asset_id, source: "hub" });
      this.data.courseModules.push(row);
      return row.id;
    };
    const copyLessons = (fromModule: string, toModule: string) => {
      for (const l of this.data.courseLessons.filter((x) => x.module_id === fromModule)) draftLesson(l, l.course_id, toModule, l.title, l.position);
    };
    const copyId = draftModule(src, src.parent_id, `${src.title.slice(0, 112)} (copy)`, await this.nextPosition("module", src.course_id, src.parent_id));
    copyLessons(id, copyId);
    for (const child of this.data.courseModules.filter((m) => m.parent_id === id && m.id !== copyId).sort((a, b) => a.position - b.position)) {
      copyLessons(child.id, draftModule(child, copyId, child.title, child.position));
    }
    return copyId;
  }

  async reorderChildren(order: { courseId: string; kind: OutlineKind; parentId: string | null; ids: string[] }) {
    if (new Set(order.ids).size !== order.ids.length) throw new CourseWriteError("stale_order");
    const children =
      order.kind === "module"
        ? this.data.courseModules.filter((m) => m.course_id === order.courseId && m.parent_id === order.parentId)
        : this.data.courseLessons.filter((l) => l.course_id === order.courseId && l.module_id === order.parentId);
    const current = children.map((c) => c.id).sort(compareText);
    const wanted = [...order.ids].sort(compareText);
    if (current.length !== wanted.length || current.some((id, i) => id !== wanted[i])) throw new CourseWriteError("stale_order");
    order.ids.forEach((id, i) => {
      const child = children.find((c) => c.id === id)!;
      child.position = i + 1;
    });
  }

  async imageOf(kind: CourseImageKind, id: string) {
    if (kind === "course" || kind === "hero") {
      const course = this.data.courses.find((c) => c.id === id);
      return course ? { assetId: kind === "course" ? course.thumbnail_asset_id : course.hero_asset_id, state: null } : null;
    }
    if (kind === "module") {
      const mod = this.data.courseModules.find((m) => m.id === id);
      return mod ? { assetId: mod.poster_asset_id, state: mod.state } : null;
    }
    const lesson = this.data.courseLessons.find((l) => l.id === id);
    return lesson ? { assetId: lesson.thumbnail_asset_id, state: lesson.state } : null;
  }

  async setImage(kind: CourseImageKind, id: string, image: { asset: string | null; source: string | null }) {
    const columns = IMAGE_COLUMNS[kind];
    const rows: Record<string, unknown>[] = kind === "course" || kind === "hero" ? this.data.courses : kind === "module" ? this.data.courseModules : this.data.courseLessons;
    const row = rows.find((r) => r.id === id);
    if (row) Object.assign(row, { [columns.asset]: image.asset, [columns.source]: image.source });
  }

  async lessonFiles(lessonId: string) {
    return this.data.courseLessonFiles
      .filter((f) => f.lesson_id === lessonId)
      .map(copy)
      .sort((a, b) => a.position - b.position || compareText(a.id, b.id));
  }

  async filesOfLessons(lessonIds: string[]) {
    const wanted = new Set(lessonIds);
    return this.data.courseLessonFiles
      .filter((f) => wanted.has(f.lesson_id))
      .map(copy)
      .sort((a, b) => compareText(a.id, b.id));
  }

  async lessonFile(lessonId: string, fileId: string) {
    const file = this.data.courseLessonFiles.find((f) => f.id === fileId && f.lesson_id === lessonId);
    return file ? copy(file) : null;
  }

  async saveLessonFile(file: NewLessonFile) {
    const existing = this.data.courseLessonFiles.find((f) => f.source_key === file.source_key);
    if (existing) return apply(existing, file);
    this.data.courseLessonFiles.push({ id: newCourseId("file"), content_hash: null, content_type: null, created_at: now(), position: 0, size_bytes: null, ...file } as Row<"course_lesson_files">);
  }

  async deleteLessonFile(id: string) {
    this.data.courseLessonFiles = this.data.courseLessonFiles.filter((f) => f.id !== id);
  }

  async video(id: string) {
    const video = this.data.videos.find((v) => v.id === id);
    return video ? copy(video) : null;
  }

  async videosBySourceKeys(kind: string, keys: string[]) {
    const wanted = new Set(keys);
    return this.data.videos
      .filter((v) => v.source_kind === kind && wanted.has(v.source_key))
      .map(copy)
      .sort((a, b) => compareText(a.id, b.id));
  }

  async createVideo(video: NewVideo) {
    const stamp = now();
    const row = {
      id: crypto.randomUUID(),
      created_at: stamp,
      duration_seconds: null,
      has_burned_in_captions: false,
      mux_asset_id: null,
      mux_playback_id: null,
      quality: "plus",
      source_fingerprint: null,
      source_sha256: null,
      status: "preparing",
      updated_at: stamp,
      ...video,
    } as Row<"videos">;
    this.data.videos.push(row);
    return row.id;
  }

  async updateVideo(id: string, patch: VideoPatch) {
    const video = this.data.videos.find((v) => v.id === id);
    if (video) {
      apply(video, patch);
      video.updated_at = now();
    }
  }

  async preparingVideos() {
    return this.data.videos
      .flatMap((v) => (v.status === "preparing" && v.mux_asset_id ? [{ id: v.id, mux_asset_id: v.mux_asset_id }] : []))
      .sort((a, b) => compareText(a.id, b.id));
  }

  async updateVideosByAsset(assetId: string, patch: VideoPatch) {
    const matching = this.data.videos.filter((v) => v.mux_asset_id === assetId);
    for (const video of matching) {
      apply(video, patch);
      video.updated_at = now();
    }
    return matching.length;
  }
}
