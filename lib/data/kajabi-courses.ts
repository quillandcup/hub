import { chunk, fetchAllRows } from "../supabase/paginate";
import type { Database, Json } from "./database.types";
import type { Db } from "./db";
import type { InMemoryDataset } from "./in-memory";

// Relative imports only: scripts/kajabi-course-content.ts uses the progress writes outside Next.

type Bronze = Database["bronze"]["Tables"];

/** Kajabi's course structure as the Bronze import keeps it (`bronze.kajabi_courses` and its modules, lessons, downloads and offers). */
export type KajabiCourse = Bronze["kajabi_courses"]["Row"];
export type NewKajabiCourse = Bronze["kajabi_courses"]["Insert"];
export type KajabiModule = Bronze["kajabi_course_modules"]["Row"];
export type NewKajabiModule = Bronze["kajabi_course_modules"]["Insert"];
export type KajabiLesson = Bronze["kajabi_course_lessons"]["Row"];
export type NewKajabiLesson = Bronze["kajabi_course_lessons"]["Insert"];
export type KajabiLessonFile = Bronze["kajabi_lesson_files"]["Row"];
export type NewKajabiLessonFile = Bronze["kajabi_lesson_files"]["Insert"];
export type KajabiCourseOffer = Bronze["kajabi_course_offers"]["Row"];
export type NewKajabiCourseOffer = Bronze["kajabi_course_offers"]["Insert"];
export type NewProductProgress = Bronze["kajabi_product_progress"]["Insert"];
export type NewLessonProgress = Bronze["kajabi_lesson_progress"]["Insert"];

/** A lesson without its text and raw payload: what outlines, visibility and the video and file plans need. */
export type KajabiLessonOutline = Pick<
  KajabiLesson,
  | "kajabi_id"
  | "course_kajabi_id"
  | "module_kajabi_id"
  | "position"
  | "title"
  | "publishing_option"
  | "video_media_id"
  | "video_source"
  | "video_duration_seconds"
  | "content_fetched_at"
  | "fetched_at"
>;
/** A lesson as the builder's lesson page shows it. */
export type KajabiLessonDetail = Pick<
  KajabiLesson,
  "kajabi_id" | "title" | "publishing_option" | "body_html" | "thumbnail_url" | "video_media_id" | "video_duration_seconds" | "content_fetched_at" | "fetched_at"
>;
/** What the content capture compares a captured lesson against. */
export type LessonContentState = Pick<KajabiLesson, "kajabi_id" | "content_hash" | "video_source">;
/** A lesson to capture content for. */
export type LessonTarget = Pick<KajabiLesson, "kajabi_id" | "course_kajabi_id" | "title" | "publishing_option">;
/** The content columns step B writes on a lesson (never the structure columns step A owns). */
export type LessonContentFields = {
  body_html: string | null;
  thumbnail_url: string | null;
  video_media_id: string | null;
  video_source: Json | null;
  content_hash: string;
  content_fetched_at: string;
};

/** A student's row of the Product Progress report, as stored (soft-deleted ones included). */
export type StoredProductProgress = {
  email: string;
  percent: number;
  logins: number | null;
  started_on: string | null;
  last_activity_on: string | null;
  deleted_at: string | null;
};
/** A student's imported progress in a course. */
export type ProductProgressReading = {
  percent: number;
  logins: number | null;
  started_on: string | null;
  last_activity_on: string | null;
  imported_at: string;
};
/** A student's lesson in the per-lesson capture, as stored (soft-deleted ones included). */
export type StoredLessonProgress = {
  kajabi_lesson_id: string;
  kajabi_contact_id: string | null;
  kajabi_member_id: string | null;
  completed: boolean;
  completed_at: string | null;
  percent: number | string | null;
  deleted_at: string | null;
};
/** A completed lesson in the capture. */
export type CompletedLessonProgress = { email: string; kajabi_lesson_id: string; completed_at: string | null; captured_at: string };

const WRITE_CHUNK = 500;
const ID_CHUNK = 100;

/**
 * Kajabi's course data in Bronze: the structure the course import upserts on Kajabi ids (courses,
 * modules, lessons, offers), the lesson text and downloads the content capture adds, and the two
 * progress snapshots (the Product Progress report and the per-lesson capture). Bronze is idempotent
 * input: writes are upserts on natural keys, and what a complete fetch no longer returns is
 * soft-deleted with `deleted_at`, never removed. Reads return live rows unless a method says
 * otherwise, paginate past 1000 rows and throw on a database error.
 */
export interface KajabiCourseRepository {
  // --- courses ---
  /** Live courses, by title. */
  liveCourses(): Promise<KajabiCourse[]>;
  /** One live course, or null. */
  liveCourse(kajabiId: string): Promise<KajabiCourse | null>;
  /** Adds courses or updates the ones with the same Kajabi id (and un-deletes them if the rows say so). Batched. */
  upsertCourses(rows: NewKajabiCourse[]): Promise<void>;
  /** Records a course's hero image and when it was captured. */
  setCourseHero(kajabiId: string, url: string, capturedAt: string): Promise<void>;
  /** Soft-deletes these courses and, with them, their modules, lessons and offers that are still live. */
  softDeleteCourses(kajabiIds: string[], at: string): Promise<void>;

  // --- modules ---
  /** A course's live modules, or every live module when no course is given. */
  liveModules(courseKajabiId?: string): Promise<KajabiModule[]>;
  liveModuleIds(courseKajabiId: string): Promise<string[]>;
  upsertModules(rows: NewKajabiModule[]): Promise<void>;
  softDeleteModules(kajabiIds: string[], at: string): Promise<void>;

  // --- lessons ---
  /** A course's live lessons with every column. */
  liveLessons(courseKajabiId: string): Promise<KajabiLesson[]>;
  /** A course's live lessons without their text and raw payload, or every live lesson's when no course is given. */
  liveLessonOutlines(courseKajabiId?: string): Promise<KajabiLessonOutline[]>;
  liveLessonIds(courseKajabiId: string): Promise<string[]>;
  /** One live lesson of a course for the lesson page, or null. */
  liveLesson(courseKajabiId: string, lessonKajabiId: string): Promise<KajabiLessonDetail | null>;
  /** What is stored of one live lesson's captured content, or null when Bronze has no such lesson. */
  contentState(lessonKajabiId: string): Promise<LessonContentState | null>;
  /** Live lessons of a course or one lesson, by id; drafts only when asked (a lesson with no publishing option is not a draft). */
  lessonTargets(scope: { courseId: string } | { lessonId: string }, options?: { includeDrafts?: boolean }): Promise<LessonTarget[]>;
  /** Writes a lesson's captured content columns. */
  saveContent(lessonKajabiId: string, fields: LessonContentFields): Promise<void>;
  /** Writes only the lesson's video source (fresh presigned links). */
  setVideoSource(lessonKajabiId: string, source: Json | null): Promise<void>;
  /** Adds lessons or updates structure columns of the ones with the same Kajabi id; columns not listed are left as they are. Batched. */
  upsertLessons(rows: NewKajabiLesson[]): Promise<void>;
  softDeleteLessons(kajabiIds: string[], at: string): Promise<void>;

  // --- lesson downloads ---
  /** The live downloads of these lessons, by filename. Chunked. */
  liveFiles(lessonKajabiIds: string[]): Promise<KajabiLessonFile[]>;
  liveFileIds(lessonKajabiId: string): Promise<string[]>;
  /** Adds downloads or updates the ones with the same Kajabi id, restoring any that were soft-deleted. Batched. */
  upsertFiles(rows: NewKajabiLessonFile[]): Promise<void>;
  setFileSourceUrl(kajabiId: string, sourceUrl: string | null): Promise<void>;
  softDeleteFiles(kajabiIds: string[], at: string): Promise<void>;

  // --- offers that grant a course ---
  /** The live offers of these courses. Chunked. */
  liveOffers(courseKajabiIds: string[]): Promise<KajabiCourseOffer[]>;
  upsertOffers(rows: NewKajabiCourseOffer[]): Promise<void>;
  /** Soft-deletes a course's offers by offer id. */
  softDeleteOffers(courseKajabiId: string, offerKajabiIds: string[], at: string): Promise<void>;

  // --- Product Progress report ---
  /** Every stored row of a course's report, soft-deleted ones included, by email. */
  productProgress(courseKajabiId: string): Promise<StoredProductProgress[]>;
  /** The highest live percent among these emails in a course, or null. */
  bestProductProgress(courseKajabiId: string, emails: string[]): Promise<ProductProgressReading | null>;
  upsertProductProgress(rows: NewProductProgress[]): Promise<void>;
  softDeleteProductProgress(courseKajabiId: string, emails: string[], at: string, importBatch: string): Promise<void>;

  // --- per-lesson capture ---
  /** Every stored lesson row of one student in a course, soft-deleted ones included, by lesson. */
  lessonProgress(courseKajabiId: string, email: string): Promise<StoredLessonProgress[]>;
  /** The live completed lessons of a course, by email then lesson. */
  completedLessons(courseKajabiId: string): Promise<CompletedLessonProgress[]>;
  upsertLessonProgress(rows: NewLessonProgress[]): Promise<void>;
  softDeleteLessonProgress(courseKajabiId: string, email: string, lessonKajabiIds: string[], at: string): Promise<void>;
}

type Page<T> = PromiseLike<{ data: T[] | null; error: { message: string } | null }>;

const OUTLINE_COLUMNS =
  "kajabi_id, course_kajabi_id, module_kajabi_id, position, title, publishing_option, video_media_id, video_source, video_duration_seconds, content_fetched_at, fetched_at";

export class SupabaseKajabiCourseRepository implements KajabiCourseRepository {
  constructor(private readonly db: Db) {}

  private get bronze() {
    return this.db.schema("bronze");
  }

  async liveCourses() {
    return fetchAllRows<KajabiCourse>(
      (a, b) => this.bronze.from("kajabi_courses").select("*").is("deleted_at", null).order("title").order("kajabi_id").range(a, b) as unknown as Page<KajabiCourse>,
    );
  }

  async liveCourse(kajabiId: string) {
    const { data, error } = await this.bronze.from("kajabi_courses").select("*").eq("kajabi_id", kajabiId).is("deleted_at", null).maybeSingle();
    if (error) throw new Error(`kajabi_courses read failed: ${error.message}`);
    return data;
  }

  async upsertCourses(rows: NewKajabiCourse[]) {
    for (const batch of chunk(rows, WRITE_CHUNK)) {
      const { error } = await this.bronze.from("kajabi_courses").upsert(batch, { onConflict: "kajabi_id" });
      if (error) throw new Error(`kajabi_courses upsert failed: ${error.message}`);
    }
  }

  async setCourseHero(kajabiId: string, url: string, capturedAt: string) {
    const { error } = await this.bronze.from("kajabi_courses").update({ hero_image_url: url, hero_captured_at: capturedAt }).eq("kajabi_id", kajabiId);
    if (error) throw new Error(`kajabi_courses update failed: ${error.message}`);
  }

  async softDeleteCourses(kajabiIds: string[], at: string) {
    for (const batch of chunk(kajabiIds, WRITE_CHUNK)) {
      const { error } = await this.bronze.from("kajabi_courses").update({ deleted_at: at }).in("kajabi_id", batch);
      if (error) throw new Error(`kajabi_courses soft-delete failed: ${error.message}`);
    }
    for (const courseId of kajabiIds) {
      const children = [
        this.bronze.from("kajabi_course_modules").update({ deleted_at: at }).eq("course_kajabi_id", courseId).is("deleted_at", null),
        this.bronze.from("kajabi_course_lessons").update({ deleted_at: at }).eq("course_kajabi_id", courseId).is("deleted_at", null),
        this.bronze.from("kajabi_course_offers").update({ deleted_at: at }).eq("course_kajabi_id", courseId).is("deleted_at", null),
      ];
      const names = ["kajabi_course_modules", "kajabi_course_lessons", "kajabi_course_offers"];
      for (const [i, query] of children.entries()) {
        const { error } = await query;
        if (error) throw new Error(`${names[i]} soft-delete failed: ${error.message}`);
      }
    }
  }

  async liveModules(courseKajabiId?: string) {
    return fetchAllRows<KajabiModule>((a, b) => {
      const query = this.bronze.from("kajabi_course_modules").select("*").is("deleted_at", null);
      return (courseKajabiId === undefined ? query : query.eq("course_kajabi_id", courseKajabiId)).order("kajabi_id").range(a, b) as unknown as Page<KajabiModule>;
    });
  }

  async liveModuleIds(courseKajabiId: string) {
    const rows = await fetchAllRows<{ kajabi_id: string }>(
      (a, b) =>
        this.bronze.from("kajabi_course_modules").select("kajabi_id").eq("course_kajabi_id", courseKajabiId).is("deleted_at", null).order("kajabi_id").range(a, b) as unknown as Page<{
          kajabi_id: string;
        }>,
    );
    return rows.map((r) => r.kajabi_id);
  }

  async upsertModules(rows: NewKajabiModule[]) {
    for (const batch of chunk(rows, WRITE_CHUNK)) {
      const { error } = await this.bronze.from("kajabi_course_modules").upsert(batch, { onConflict: "kajabi_id" });
      if (error) throw new Error(`kajabi_course_modules upsert failed: ${error.message}`);
    }
  }

  async softDeleteModules(kajabiIds: string[], at: string) {
    for (const batch of chunk(kajabiIds, WRITE_CHUNK)) {
      const { error } = await this.bronze.from("kajabi_course_modules").update({ deleted_at: at }).in("kajabi_id", batch);
      if (error) throw new Error(`kajabi_course_modules soft-delete failed: ${error.message}`);
    }
  }

  async liveLessons(courseKajabiId: string) {
    return fetchAllRows<KajabiLesson>(
      (a, b) =>
        this.bronze.from("kajabi_course_lessons").select("*").eq("course_kajabi_id", courseKajabiId).is("deleted_at", null).order("kajabi_id").range(a, b) as unknown as Page<KajabiLesson>,
    );
  }

  async liveLessonOutlines(courseKajabiId?: string) {
    return fetchAllRows<KajabiLessonOutline>((a, b) => {
      const query = this.bronze.from("kajabi_course_lessons").select(OUTLINE_COLUMNS).is("deleted_at", null);
      return (courseKajabiId === undefined ? query : query.eq("course_kajabi_id", courseKajabiId)).order("kajabi_id").range(a, b) as unknown as Page<KajabiLessonOutline>;
    });
  }

  async liveLessonIds(courseKajabiId: string) {
    const rows = await fetchAllRows<{ kajabi_id: string }>(
      (a, b) =>
        this.bronze.from("kajabi_course_lessons").select("kajabi_id").eq("course_kajabi_id", courseKajabiId).is("deleted_at", null).order("kajabi_id").range(a, b) as unknown as Page<{
          kajabi_id: string;
        }>,
    );
    return rows.map((r) => r.kajabi_id);
  }

  async liveLesson(courseKajabiId: string, lessonKajabiId: string) {
    const { data, error } = await this.bronze
      .from("kajabi_course_lessons")
      .select("kajabi_id, title, publishing_option, body_html, thumbnail_url, video_media_id, video_duration_seconds, content_fetched_at, fetched_at")
      .eq("kajabi_id", lessonKajabiId)
      .eq("course_kajabi_id", courseKajabiId)
      .is("deleted_at", null)
      .maybeSingle();
    if (error) throw new Error(`course lesson read failed: ${error.message}`);
    return data;
  }

  async contentState(lessonKajabiId: string) {
    const { data, error } = await this.bronze
      .from("kajabi_course_lessons")
      .select("kajabi_id, content_hash, video_source")
      .eq("kajabi_id", lessonKajabiId)
      .is("deleted_at", null)
      .maybeSingle();
    if (error) throw new Error(`kajabi_course_lessons: ${error.message}`);
    return data;
  }

  async lessonTargets(scope: { courseId: string } | { lessonId: string }, { includeDrafts = false }: { includeDrafts?: boolean } = {}) {
    try {
      return await fetchAllRows<LessonTarget>((a, b) => {
        let query = this.bronze.from("kajabi_course_lessons").select("kajabi_id, course_kajabi_id, title, publishing_option").is("deleted_at", null).order("kajabi_id");
        query = "courseId" in scope ? query.eq("course_kajabi_id", scope.courseId) : query.eq("kajabi_id", scope.lessonId);
        // neq alone would also drop rows where publishing_option is NULL.
        if (!includeDrafts) query = query.or("publishing_option.is.null,publishing_option.neq.draft");
        return query.range(a, b) as unknown as Page<LessonTarget>;
      });
    } catch (error) {
      throw new Error(`kajabi_course_lessons: ${(error as Error).message}`);
    }
  }

  async saveContent(lessonKajabiId: string, fields: LessonContentFields) {
    const { error } = await this.bronze.from("kajabi_course_lessons").update(fields).eq("kajabi_id", lessonKajabiId);
    if (error) throw new Error(`kajabi_course_lessons: ${error.message}`);
  }

  async setVideoSource(lessonKajabiId: string, source: Json | null) {
    const { error } = await this.bronze.from("kajabi_course_lessons").update({ video_source: source }).eq("kajabi_id", lessonKajabiId);
    if (error) throw new Error(`kajabi_course_lessons: ${error.message}`);
  }

  async upsertLessons(rows: NewKajabiLesson[]) {
    for (const batch of chunk(rows, WRITE_CHUNK)) {
      const { error } = await this.bronze.from("kajabi_course_lessons").upsert(batch, { onConflict: "kajabi_id" });
      if (error) throw new Error(`kajabi_course_lessons upsert failed: ${error.message}`);
    }
  }

  async softDeleteLessons(kajabiIds: string[], at: string) {
    for (const batch of chunk(kajabiIds, WRITE_CHUNK)) {
      const { error } = await this.bronze.from("kajabi_course_lessons").update({ deleted_at: at }).in("kajabi_id", batch);
      if (error) throw new Error(`kajabi_course_lessons soft-delete failed: ${error.message}`);
    }
  }

  async liveFiles(lessonKajabiIds: string[]) {
    const rows: KajabiLessonFile[] = [];
    for (const part of chunk([...new Set(lessonKajabiIds)], ID_CHUNK)) {
      rows.push(
        ...(await fetchAllRows<KajabiLessonFile>(
          (a, b) =>
            this.bronze.from("kajabi_lesson_files").select("*").in("lesson_kajabi_id", part).is("deleted_at", null).order("filename").order("kajabi_id").range(a, b) as unknown as Page<KajabiLessonFile>,
        )),
      );
    }
    return rows.sort((x, y) => (x.filename < y.filename ? -1 : x.filename > y.filename ? 1 : x.kajabi_id < y.kajabi_id ? -1 : x.kajabi_id > y.kajabi_id ? 1 : 0));
  }

  async liveFileIds(lessonKajabiId: string) {
    const rows = await fetchAllRows<{ kajabi_id: string }>(
      (a, b) =>
        this.bronze.from("kajabi_lesson_files").select("kajabi_id").eq("lesson_kajabi_id", lessonKajabiId).is("deleted_at", null).order("kajabi_id").range(a, b) as unknown as Page<{
          kajabi_id: string;
        }>,
    );
    return rows.map((r) => r.kajabi_id);
  }

  async upsertFiles(rows: NewKajabiLessonFile[]) {
    for (const batch of chunk(rows, WRITE_CHUNK)) {
      const { error } = await this.bronze.from("kajabi_lesson_files").upsert(batch, { onConflict: "kajabi_id" });
      if (error) throw new Error(`kajabi_lesson_files: ${error.message}`);
    }
  }

  async setFileSourceUrl(kajabiId: string, sourceUrl: string | null) {
    const { error } = await this.bronze.from("kajabi_lesson_files").update({ source_url: sourceUrl }).eq("kajabi_id", kajabiId);
    if (error) throw new Error(`kajabi_lesson_files: ${error.message}`);
  }

  async softDeleteFiles(kajabiIds: string[], at: string) {
    for (const batch of chunk(kajabiIds, ID_CHUNK)) {
      const { error } = await this.bronze.from("kajabi_lesson_files").update({ deleted_at: at }).in("kajabi_id", batch);
      if (error) throw new Error(`kajabi_lesson_files: ${error.message}`);
    }
  }

  async liveOffers(courseKajabiIds: string[]) {
    const rows: KajabiCourseOffer[] = [];
    for (const part of chunk([...new Set(courseKajabiIds)], ID_CHUNK)) {
      rows.push(
        ...(await fetchAllRows<KajabiCourseOffer>(
          (a, b) =>
            this.bronze.from("kajabi_course_offers").select("*").in("course_kajabi_id", part).is("deleted_at", null).order("course_kajabi_id").order("offer_kajabi_id").range(a, b) as unknown as Page<KajabiCourseOffer>,
        )),
      );
    }
    return rows;
  }

  async upsertOffers(rows: NewKajabiCourseOffer[]) {
    for (const batch of chunk(rows, WRITE_CHUNK)) {
      const { error } = await this.bronze.from("kajabi_course_offers").upsert(batch, { onConflict: "course_kajabi_id,offer_kajabi_id" });
      if (error) throw new Error(`kajabi_course_offers upsert failed: ${error.message}`);
    }
  }

  async softDeleteOffers(courseKajabiId: string, offerKajabiIds: string[], at: string) {
    for (const batch of chunk(offerKajabiIds, WRITE_CHUNK)) {
      const { error } = await this.bronze.from("kajabi_course_offers").update({ deleted_at: at }).eq("course_kajabi_id", courseKajabiId).in("offer_kajabi_id", batch);
      if (error) throw new Error(`kajabi_course_offers soft-delete failed: ${error.message}`);
    }
  }

  async productProgress(courseKajabiId: string) {
    return fetchAllRows<StoredProductProgress>(
      (a, b) =>
        this.bronze
          .from("kajabi_product_progress")
          .select("email, percent, logins, started_on, last_activity_on, deleted_at")
          .eq("course_kajabi_id", courseKajabiId)
          .order("email")
          .range(a, b) as unknown as Page<StoredProductProgress>,
    );
  }

  async bestProductProgress(courseKajabiId: string, emails: string[]) {
    let best: ProductProgressReading | null = null;
    for (const part of chunk([...new Set(emails)], ID_CHUNK)) {
      const { data, error } = await this.bronze
        .from("kajabi_product_progress")
        .select("percent, logins, started_on, last_activity_on, imported_at")
        .eq("course_kajabi_id", courseKajabiId)
        .is("deleted_at", null)
        .in("email", part)
        .order("percent", { ascending: false })
        .limit(1);
      if (error) throw new Error(`Could not read imported progress: ${error.message}`);
      const row = data?.[0];
      if (row && (!best || Number(row.percent) > Number(best.percent))) best = row;
    }
    return best;
  }

  async upsertProductProgress(rows: NewProductProgress[]) {
    for (const batch of chunk(rows, WRITE_CHUNK)) {
      const { error } = await this.bronze.from("kajabi_product_progress").upsert(batch, { onConflict: "course_kajabi_id,email" });
      if (error) throw new Error(`Could not save progress rows: ${error.message}`);
    }
  }

  async softDeleteProductProgress(courseKajabiId: string, emails: string[], at: string, importBatch: string) {
    for (const batch of chunk(emails, ID_CHUNK)) {
      const { error } = await this.bronze
        .from("kajabi_product_progress")
        .update({ deleted_at: at, import_batch: importBatch })
        .eq("course_kajabi_id", courseKajabiId)
        .in("email", batch);
      if (error) throw new Error(`Could not remove progress rows: ${error.message}`);
    }
  }

  async lessonProgress(courseKajabiId: string, email: string) {
    return fetchAllRows<StoredLessonProgress>(
      (a, b) =>
        this.bronze
          .from("kajabi_lesson_progress")
          .select("kajabi_lesson_id, kajabi_contact_id, kajabi_member_id, completed, completed_at, percent, deleted_at")
          .eq("course_kajabi_id", courseKajabiId)
          .eq("email", email)
          .order("kajabi_lesson_id")
          .range(a, b) as unknown as Page<StoredLessonProgress>,
    );
  }

  async completedLessons(courseKajabiId: string) {
    return fetchAllRows<CompletedLessonProgress>(
      (a, b) =>
        this.bronze
          .from("kajabi_lesson_progress")
          .select("email, kajabi_lesson_id, completed_at, captured_at")
          .eq("course_kajabi_id", courseKajabiId)
          .eq("completed", true)
          .is("deleted_at", null)
          .order("email")
          .order("kajabi_lesson_id")
          .range(a, b) as unknown as Page<CompletedLessonProgress>,
    );
  }

  async upsertLessonProgress(rows: NewLessonProgress[]) {
    for (const batch of chunk(rows, WRITE_CHUNK)) {
      const { error } = await this.bronze.from("kajabi_lesson_progress").upsert(batch, { onConflict: "course_kajabi_id,email,kajabi_lesson_id" });
      if (error) throw new Error(`Could not save lesson progress: ${error.message}`);
    }
  }

  async softDeleteLessonProgress(courseKajabiId: string, email: string, lessonKajabiIds: string[], at: string) {
    for (const batch of chunk(lessonKajabiIds, ID_CHUNK)) {
      const { error } = await this.bronze
        .from("kajabi_lesson_progress")
        .update({ deleted_at: at })
        .eq("course_kajabi_id", courseKajabiId)
        .eq("email", email)
        .in("kajabi_lesson_id", batch);
      if (error) throw new Error(`Could not remove lesson progress: ${error.message}`);
    }
  }
}

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const live = <T extends { deleted_at: string | null }>(rows: T[]) => rows.filter((r) => r.deleted_at === null);

/** In-memory twin over an `InMemoryDataset`. */
export class InMemoryKajabiCourseRepository implements KajabiCourseRepository {
  constructor(private readonly data: InMemoryDataset) {}

  async liveCourses() {
    return live(this.data.kajabiCourses)
      .map((c) => ({ ...c }))
      .sort((a, b) => cmp(a.title, b.title) || cmp(a.kajabi_id, b.kajabi_id));
  }

  async liveCourse(kajabiId: string) {
    const c = live(this.data.kajabiCourses).find((x) => x.kajabi_id === kajabiId);
    return c ? { ...c } : null;
  }

  async upsertCourses(rows: NewKajabiCourse[]) {
    for (const row of rows) {
      const existing = this.data.kajabiCourses.find((x) => x.kajabi_id === row.kajabi_id);
      if (existing) Object.assign(existing, row);
      else
        this.data.kajabiCourses.push({
          deleted_at: null,
          fetched_at: new Date().toISOString(),
          raw_payload: {},
          hero_captured_at: null,
          hero_image_url: null,
          publishing_option: null,
          ...row,
        });
    }
  }

  async setCourseHero(kajabiId: string, url: string, capturedAt: string) {
    for (const c of this.data.kajabiCourses) if (c.kajabi_id === kajabiId) Object.assign(c, { hero_image_url: url, hero_captured_at: capturedAt });
  }

  async softDeleteCourses(kajabiIds: string[], at: string) {
    const ids = new Set(kajabiIds);
    for (const c of this.data.kajabiCourses) if (ids.has(c.kajabi_id)) c.deleted_at = at;
    for (const rows of [this.data.kajabiModules, this.data.kajabiLessons, this.data.kajabiCourseOffers]) {
      for (const r of rows) if (ids.has(r.course_kajabi_id) && r.deleted_at === null) r.deleted_at = at;
    }
  }

  async liveModules(courseKajabiId?: string) {
    return live(this.data.kajabiModules)
      .filter((m) => courseKajabiId === undefined || m.course_kajabi_id === courseKajabiId)
      .map((m) => ({ ...m }))
      .sort((a, b) => cmp(a.kajabi_id, b.kajabi_id));
  }

  async liveModuleIds(courseKajabiId: string) {
    return (await this.liveModules(courseKajabiId)).map((m) => m.kajabi_id);
  }

  async upsertModules(rows: NewKajabiModule[]) {
    for (const row of rows) {
      const existing = this.data.kajabiModules.find((x) => x.kajabi_id === row.kajabi_id);
      if (existing) Object.assign(existing, row);
      else this.data.kajabiModules.push({ raw_payload: {}, deleted_at: null, fetched_at: new Date().toISOString(), parent_kajabi_id: null, position: null, poster_url: null, publishing_option: null, ...row });
    }
  }

  async softDeleteModules(kajabiIds: string[], at: string) {
    const ids = new Set(kajabiIds);
    for (const m of this.data.kajabiModules) if (ids.has(m.kajabi_id)) m.deleted_at = at;
  }

  async liveLessons(courseKajabiId: string) {
    return live(this.data.kajabiLessons)
      .filter((l) => l.course_kajabi_id === courseKajabiId)
      .map((l) => ({ ...l }))
      .sort((a, b) => cmp(a.kajabi_id, b.kajabi_id));
  }

  async liveLessonOutlines(courseKajabiId?: string) {
    return live(this.data.kajabiLessons)
      .filter((l) => courseKajabiId === undefined || l.course_kajabi_id === courseKajabiId)
      .sort((a, b) => cmp(a.kajabi_id, b.kajabi_id))
      .map((l) => ({
      kajabi_id: l.kajabi_id,
      course_kajabi_id: l.course_kajabi_id,
      module_kajabi_id: l.module_kajabi_id,
      position: l.position,
      title: l.title,
      publishing_option: l.publishing_option,
      video_media_id: l.video_media_id,
      video_source: l.video_source,
      video_duration_seconds: l.video_duration_seconds,
      content_fetched_at: l.content_fetched_at,
      fetched_at: l.fetched_at,
    }));
  }

  async liveLessonIds(courseKajabiId: string) {
    return (await this.liveLessons(courseKajabiId)).map((l) => l.kajabi_id);
  }

  async liveLesson(courseKajabiId: string, lessonKajabiId: string) {
    const l = live(this.data.kajabiLessons).find((x) => x.kajabi_id === lessonKajabiId && x.course_kajabi_id === courseKajabiId);
    if (!l) return null;
    return {
      kajabi_id: l.kajabi_id,
      title: l.title,
      publishing_option: l.publishing_option,
      body_html: l.body_html,
      thumbnail_url: l.thumbnail_url,
      video_media_id: l.video_media_id,
      video_duration_seconds: l.video_duration_seconds,
      content_fetched_at: l.content_fetched_at,
      fetched_at: l.fetched_at,
    };
  }

  async contentState(lessonKajabiId: string) {
    const l = live(this.data.kajabiLessons).find((x) => x.kajabi_id === lessonKajabiId);
    return l ? { kajabi_id: l.kajabi_id, content_hash: l.content_hash, video_source: l.video_source } : null;
  }

  async lessonTargets(scope: { courseId: string } | { lessonId: string }, { includeDrafts = false }: { includeDrafts?: boolean } = {}) {
    return live(this.data.kajabiLessons)
      .filter((l) => ("courseId" in scope ? l.course_kajabi_id === scope.courseId : l.kajabi_id === scope.lessonId))
      .filter((l) => includeDrafts || l.publishing_option !== "draft")
      .map((l) => ({ kajabi_id: l.kajabi_id, course_kajabi_id: l.course_kajabi_id, title: l.title, publishing_option: l.publishing_option }))
      .sort((a, b) => cmp(a.kajabi_id, b.kajabi_id));
  }

  async saveContent(lessonKajabiId: string, fields: LessonContentFields) {
    for (const l of this.data.kajabiLessons) if (l.kajabi_id === lessonKajabiId) Object.assign(l, fields);
  }

  async setVideoSource(lessonKajabiId: string, source: Json | null) {
    for (const l of this.data.kajabiLessons) if (l.kajabi_id === lessonKajabiId) l.video_source = source;
  }

  async upsertLessons(rows: NewKajabiLesson[]) {
    for (const row of rows) {
      const existing = this.data.kajabiLessons.find((x) => x.kajabi_id === row.kajabi_id);
      if (existing) Object.assign(existing, row);
      else
        this.data.kajabiLessons.push({
          raw_payload: {},
          body_html: null,
          content_fetched_at: null,
          content_hash: null,
          deleted_at: null,
          fetched_at: new Date().toISOString(),
          module_kajabi_id: null,
          position: null,
          publishing_option: null,
          thumbnail_url: null,
          video_duration_seconds: null,
          video_media_id: null,
          video_source: null,
          ...row,
        });
    }
  }

  async softDeleteLessons(kajabiIds: string[], at: string) {
    const ids = new Set(kajabiIds);
    for (const l of this.data.kajabiLessons) if (ids.has(l.kajabi_id)) l.deleted_at = at;
  }

  async liveFiles(lessonKajabiIds: string[]) {
    const lessons = new Set(lessonKajabiIds);
    return live(this.data.kajabiLessonFiles)
      .filter((f) => lessons.has(f.lesson_kajabi_id))
      .map((f) => ({ ...f }))
      .sort((a, b) => cmp(a.filename, b.filename) || cmp(a.kajabi_id, b.kajabi_id));
  }

  async liveFileIds(lessonKajabiId: string) {
    return live(this.data.kajabiLessonFiles)
      .filter((f) => f.lesson_kajabi_id === lessonKajabiId)
      .map((f) => f.kajabi_id)
      .sort(cmp);
  }

  async upsertFiles(rows: NewKajabiLessonFile[]) {
    for (const row of rows) {
      const existing = this.data.kajabiLessonFiles.find((x) => x.kajabi_id === row.kajabi_id);
      if (existing) Object.assign(existing, row);
      else this.data.kajabiLessonFiles.push({ raw_payload: {}, content_type: null, deleted_at: null, fetched_at: new Date().toISOString(), size_bytes: null, source_url: null, ...row });
    }
  }

  async setFileSourceUrl(kajabiId: string, sourceUrl: string | null) {
    for (const f of this.data.kajabiLessonFiles) if (f.kajabi_id === kajabiId) f.source_url = sourceUrl;
  }

  async softDeleteFiles(kajabiIds: string[], at: string) {
    const ids = new Set(kajabiIds);
    for (const f of this.data.kajabiLessonFiles) if (ids.has(f.kajabi_id)) f.deleted_at = at;
  }

  async liveOffers(courseKajabiIds: string[]) {
    const courses = new Set(courseKajabiIds);
    return live(this.data.kajabiCourseOffers)
      .filter((o) => courses.has(o.course_kajabi_id))
      .map((o) => ({ ...o }))
      .sort((a, b) => cmp(a.course_kajabi_id, b.course_kajabi_id) || cmp(a.offer_kajabi_id, b.offer_kajabi_id));
  }

  async upsertOffers(rows: NewKajabiCourseOffer[]) {
    for (const row of rows) {
      const existing = this.data.kajabiCourseOffers.find((x) => x.course_kajabi_id === row.course_kajabi_id && x.offer_kajabi_id === row.offer_kajabi_id);
      if (existing) Object.assign(existing, row);
      else this.data.kajabiCourseOffers.push({ deleted_at: null, fetched_at: new Date().toISOString(), offer_title: null, ...row });
    }
  }

  async softDeleteOffers(courseKajabiId: string, offerKajabiIds: string[], at: string) {
    const ids = new Set(offerKajabiIds);
    for (const o of this.data.kajabiCourseOffers) if (o.course_kajabi_id === courseKajabiId && ids.has(o.offer_kajabi_id)) o.deleted_at = at;
  }

  async productProgress(courseKajabiId: string) {
    return this.data.kajabiProductProgress
      .filter((p) => p.course_kajabi_id === courseKajabiId)
      .map((p) => ({ email: p.email, percent: p.percent, logins: p.logins, started_on: p.started_on, last_activity_on: p.last_activity_on, deleted_at: p.deleted_at }))
      .sort((a, b) => cmp(a.email, b.email));
  }

  async bestProductProgress(courseKajabiId: string, emails: string[]) {
    const wanted = new Set(emails);
    const rows = live(this.data.kajabiProductProgress).filter((p) => p.course_kajabi_id === courseKajabiId && wanted.has(p.email));
    if (rows.length === 0) return null;
    const best = rows.reduce((a, b) => (Number(b.percent) > Number(a.percent) ? b : a));
    return { percent: best.percent, logins: best.logins, started_on: best.started_on, last_activity_on: best.last_activity_on, imported_at: best.imported_at };
  }

  async upsertProductProgress(rows: NewProductProgress[]) {
    for (const row of rows) {
      const existing = this.data.kajabiProductProgress.find((x) => x.course_kajabi_id === row.course_kajabi_id && x.email === row.email);
      if (existing) Object.assign(existing, row);
      else
        this.data.kajabiProductProgress.push({
          deleted_at: null,
          imported_at: new Date().toISOString(),
          last_activity_on: null,
          logins: null,
          source_file: null,
          started_on: null,
          ...row,
        });
    }
  }

  async softDeleteProductProgress(courseKajabiId: string, emails: string[], at: string, importBatch: string) {
    const wanted = new Set(emails);
    for (const p of this.data.kajabiProductProgress) {
      if (p.course_kajabi_id === courseKajabiId && wanted.has(p.email)) Object.assign(p, { deleted_at: at, import_batch: importBatch });
    }
  }

  async lessonProgress(courseKajabiId: string, email: string) {
    return this.data.kajabiLessonProgress
      .filter((p) => p.course_kajabi_id === courseKajabiId && p.email === email)
      .map((p) => ({
        kajabi_lesson_id: p.kajabi_lesson_id,
        kajabi_contact_id: p.kajabi_contact_id,
        kajabi_member_id: p.kajabi_member_id,
        completed: p.completed,
        completed_at: p.completed_at,
        percent: p.percent,
        deleted_at: p.deleted_at,
      }))
      .sort((a, b) => cmp(a.kajabi_lesson_id, b.kajabi_lesson_id));
  }

  async completedLessons(courseKajabiId: string) {
    return live(this.data.kajabiLessonProgress)
      .filter((p) => p.course_kajabi_id === courseKajabiId && p.completed)
      .map((p) => ({ email: p.email, kajabi_lesson_id: p.kajabi_lesson_id, completed_at: p.completed_at, captured_at: p.captured_at }))
      .sort((a, b) => cmp(a.email, b.email) || cmp(a.kajabi_lesson_id, b.kajabi_lesson_id));
  }

  async upsertLessonProgress(rows: NewLessonProgress[]) {
    for (const row of rows) {
      const existing = this.data.kajabiLessonProgress.find(
        (x) => x.course_kajabi_id === row.course_kajabi_id && x.email === row.email && x.kajabi_lesson_id === row.kajabi_lesson_id,
      );
      if (existing) Object.assign(existing, row);
      else
        this.data.kajabiLessonProgress.push({
          captured_at: new Date().toISOString(),
          completed_at: null,
          deleted_at: null,
          kajabi_contact_id: null,
          kajabi_member_id: null,
          percent: null,
          ...row,
        });
    }
  }

  async softDeleteLessonProgress(courseKajabiId: string, email: string, lessonKajabiIds: string[], at: string) {
    const wanted = new Set(lessonKajabiIds);
    for (const p of this.data.kajabiLessonProgress) {
      if (p.course_kajabi_id === courseKajabiId && p.email === email && wanted.has(p.kajabi_lesson_id)) p.deleted_at = at;
    }
  }
}
