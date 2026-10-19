import type { SupabaseClient } from "@supabase/supabase-js";
import type { KajabiCourseResource, KajabiCourseResponse } from "@/lib/kajabi/client";
import { idsToSoftDelete, parseKajabiCourse, type ParsedCourse } from "@/lib/kajabi/courses";
import { fetchAllBronzeRows } from "@/lib/supabase/bronze-pagination";

/**
 * Kajabi courses -> Bronze (docs/COURSES.md, step A of the migration).
 *
 * Structure only: courses, modules, lessons and the offers that grant each course, from Kajabi's
 * public API. Lesson text, downloads and video sources come from the content script (step B)
 * and live in other columns of the same rows, so the upserts below never list them and a
 * re-import leaves them alone.
 *
 * Idempotent: upsert on Kajabi ids. Rows a *complete* fetch no longer returns are soft-deleted
 * (`deleted_at`); a row that comes back is undeleted. Everything is fetched before anything is
 * written, so a failed Kajabi call aborts with no soft-deletes (it must not read as a mass
 * deletion). `courseIds` limits the run to those courses and skips the "course disappeared" step.
 *
 * Needs a service-role client: signed-in admins can read these tables but not write them.
 */

const WRITE_BATCH = 500;

function chunks<T>(rows: T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += WRITE_BATCH) out.push(rows.slice(i, i + WRITE_BATCH));
  return out;
}

export interface KajabiCoursesApi {
  fetchAllCourses(): Promise<KajabiCourseResource[]>;
  fetchCourse(courseId: string): Promise<KajabiCourseResponse>;
}

export class CourseImportError extends Error {
  constructor(message: string, readonly status = 500) {
    super(message);
  }
}

export interface ImportedCourse {
  id: string;
  title: string;
  modules: number;
  lessons: number;
  offers: number;
  /** Lessons whose module couldn't be resolved from Kajabi's response; above zero means the live shape differs from what's assumed. */
  unplacedLessons: number;
}

export interface CoursesImportResult {
  courses: ImportedCourse[];
  softDeleted: { courses: number; modules: number; lessons: number; offers: number };
}

export async function importKajabiCourses(
  supabase: SupabaseClient,
  kajabi: KajabiCoursesApi,
  options: { courseIds?: string[] } = {}
): Promise<CoursesImportResult> {
  const onlyIds = options.courseIds && options.courseIds.length > 0 ? options.courseIds.map(String) : null;

  const siteCourses = await kajabi.fetchAllCourses();
  const siteCourseIds = siteCourses.map((c) => String(c.id));
  const targetIds = onlyIds ? siteCourseIds.filter((id) => onlyIds.includes(id)) : siteCourseIds;
  if (onlyIds && targetIds.length !== onlyIds.length) {
    const missing = onlyIds.filter((id) => !siteCourseIds.includes(id));
    throw new CourseImportError(`Courses not found in Kajabi: ${missing.join(", ")}`, 404);
  }

  // Fetch everything first: nothing is written (or soft-deleted) unless every call succeeded.
  const parsed: ParsedCourse[] = [];
  for (const id of targetIds) parsed.push(parseKajabiCourse(await kajabi.fetchCourse(id)));

  const fetchedAt = new Date().toISOString();
  const bronze = supabase.schema("bronze");

  const upsert = async (table: string, rows: object[], onConflict: string) => {
    for (const batch of chunks(rows)) {
      const { error } = await bronze.from(table).upsert(batch, { onConflict });
      if (error) throw new Error(`${table} upsert failed: ${error.message}`);
    }
  };

  await upsert(
    "kajabi_courses",
    parsed.map((p) => ({
      kajabi_id: p.course.kajabiId,
      title: p.course.title,
      raw_payload: p.course.raw,
      fetched_at: fetchedAt,
      deleted_at: null,
    })),
    "kajabi_id"
  );
  await upsert(
    "kajabi_course_modules",
    parsed.flatMap((p) =>
      p.modules.map((m) => ({
        kajabi_id: m.kajabiId,
        course_kajabi_id: p.course.kajabiId,
        parent_kajabi_id: m.parentKajabiId,
        position: m.position,
        title: m.title,
        publishing_option: m.publishingOption,
        poster_url: m.posterUrl,
        raw_payload: m.raw,
        fetched_at: fetchedAt,
        deleted_at: null,
      }))
    ),
    "kajabi_id"
  );
  // No body_html, thumbnail_url, video_* or content_* here: those belong to step B.
  await upsert(
    "kajabi_course_lessons",
    parsed.flatMap((p) =>
      p.lessons.map((l) => ({
        kajabi_id: l.kajabiId,
        course_kajabi_id: p.course.kajabiId,
        module_kajabi_id: l.moduleKajabiId,
        position: l.position,
        title: l.title,
        publishing_option: l.publishingOption,
        video_duration_seconds: l.videoDurationSeconds,
        raw_payload: l.raw,
        fetched_at: fetchedAt,
        deleted_at: null,
      }))
    ),
    "kajabi_id"
  );
  await upsert(
    "kajabi_course_offers",
    parsed.flatMap((p) =>
      p.offers.map((o) => ({
        course_kajabi_id: p.course.kajabiId,
        offer_kajabi_id: o.kajabiId,
        offer_title: o.title,
        fetched_at: fetchedAt,
        deleted_at: null,
      }))
    ),
    "course_kajabi_id,offer_kajabi_id"
  );

  // Soft-delete what the complete fetch no longer returns, per course.
  const softDeleted = { courses: 0, modules: 0, lessons: 0, offers: 0 };
  const softDelete = async (table: string, keyColumn: string, ids: string[]) => {
    for (const batch of chunks(ids)) {
      const { error } = await bronze.from(table).update({ deleted_at: fetchedAt }).in(keyColumn, batch);
      if (error) throw new Error(`${table} soft-delete failed: ${error.message}`);
    }
  };
  for (const p of parsed) {
    const courseId = p.course.kajabiId;
    for (const [table, kind, fetched] of [
      ["kajabi_course_modules", "modules", p.modules.map((m) => m.kajabiId)],
      ["kajabi_course_lessons", "lessons", p.lessons.map((l) => l.kajabiId)],
    ] as const) {
      const live = await fetchAllBronzeRows(supabase, table, "kajabi_id", (q) =>
        q.eq("course_kajabi_id", courseId).is("deleted_at", null)
      );
      const gone = idsToSoftDelete(live.map((r) => r.kajabi_id), fetched);
      await softDelete(table, "kajabi_id", gone);
      softDeleted[kind] += gone.length;
    }
    const liveOffers = await fetchAllBronzeRows(supabase, "kajabi_course_offers", "offer_kajabi_id", (q) =>
      q.eq("course_kajabi_id", courseId).is("deleted_at", null)
    );
    const goneOffers = idsToSoftDelete(liveOffers.map((r) => r.offer_kajabi_id), p.offers.map((o) => o.kajabiId));
    for (const batch of chunks(goneOffers)) {
      const { error } = await bronze
        .from("kajabi_course_offers")
        .update({ deleted_at: fetchedAt })
        .eq("course_kajabi_id", courseId)
        .in("offer_kajabi_id", batch);
      if (error) throw new Error(`kajabi_course_offers soft-delete failed: ${error.message}`);
    }
    softDeleted.offers += goneOffers.length;
  }

  // A whole course that's gone from the site (only knowable from a full, unfiltered list).
  if (!onlyIds) {
    const liveCourses = await fetchAllBronzeRows(supabase, "kajabi_courses", "kajabi_id", (q) => q.is("deleted_at", null));
    const goneCourses = idsToSoftDelete(liveCourses.map((r) => r.kajabi_id), siteCourseIds);
    await softDelete("kajabi_courses", "kajabi_id", goneCourses);
    for (const courseId of goneCourses) {
      for (const table of ["kajabi_course_modules", "kajabi_course_lessons", "kajabi_course_offers"]) {
        const { error } = await bronze
          .from(table)
          .update({ deleted_at: fetchedAt })
          .eq("course_kajabi_id", courseId)
          .is("deleted_at", null);
        if (error) throw new Error(`${table} soft-delete failed: ${error.message}`);
      }
    }
    softDeleted.courses = goneCourses.length;
  }

  return {
    courses: parsed.map((p) => ({
      id: p.course.kajabiId,
      title: p.course.title,
      modules: p.modules.length,
      lessons: p.lessons.length,
      offers: p.offers.length,
      unplacedLessons: p.unplacedLessons,
    })),
    softDeleted,
  };
}
