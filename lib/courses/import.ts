import { ensureDraftCourses } from "@/lib/courses/process";
import type { KajabiCourseResource, KajabiCourseResponse } from "@/lib/kajabi/client";
import { idsToSoftDelete, parseKajabiCourse, type ParsedCourse } from "@/lib/kajabi/courses";
import { asJson } from "@/lib/data/json";
import type { Repos } from "@/lib/data/repos";

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
  repos: Pick<Repos, "courses" | "kajabiCourses">,
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
  const repo = repos.kajabiCourses;

  await repo.upsertCourses(
    parsed.map((p) => ({
      kajabi_id: p.course.kajabiId,
      title: p.course.title,
      raw_payload: asJson(p.course.raw),
      fetched_at: fetchedAt,
      deleted_at: null,
    }))
  );
  await repo.upsertModules(
    parsed.flatMap((p) =>
      p.modules.map((m) => ({
        kajabi_id: m.kajabiId,
        course_kajabi_id: p.course.kajabiId,
        parent_kajabi_id: m.parentKajabiId,
        position: m.position,
        title: m.title,
        publishing_option: m.publishingOption,
        poster_url: m.posterUrl,
        raw_payload: asJson(m.raw),
        fetched_at: fetchedAt,
        deleted_at: null,
      }))
    )
  );
  // No body_html, thumbnail_url, video_* or content_* here: those belong to step B.
  await repo.upsertLessons(
    parsed.flatMap((p) =>
      p.lessons.map((l) => ({
        kajabi_id: l.kajabiId,
        course_kajabi_id: p.course.kajabiId,
        module_kajabi_id: l.moduleKajabiId,
        position: l.position,
        title: l.title,
        publishing_option: l.publishingOption,
        video_duration_seconds: l.videoDurationSeconds,
        raw_payload: asJson(l.raw),
        fetched_at: fetchedAt,
        deleted_at: null,
      }))
    )
  );
  await repo.upsertOffers(
    parsed.flatMap((p) =>
      p.offers.map((o) => ({
        course_kajabi_id: p.course.kajabiId,
        offer_kajabi_id: o.kajabiId,
        offer_title: o.title,
        fetched_at: fetchedAt,
        deleted_at: null,
      }))
    )
  );

  // Soft-delete what the complete fetch no longer returns, per course.
  const softDeleted = { courses: 0, modules: 0, lessons: 0, offers: 0 };
  for (const p of parsed) {
    const courseId = p.course.kajabiId;
    const goneModules = idsToSoftDelete((await repo.liveModules(courseId)).map((m) => m.kajabi_id), p.modules.map((m) => m.kajabiId));
    await repo.softDeleteModules(goneModules, fetchedAt);
    softDeleted.modules += goneModules.length;
    const goneLessons = idsToSoftDelete((await repo.liveLessonOutlines(courseId)).map((l) => l.kajabi_id), p.lessons.map((l) => l.kajabiId));
    await repo.softDeleteLessons(goneLessons, fetchedAt);
    softDeleted.lessons += goneLessons.length;
    const liveOffers = await repo.liveOffers([courseId]);
    const goneOffers = idsToSoftDelete(liveOffers.map((r) => r.offer_kajabi_id), p.offers.map((o) => o.kajabiId));
    await repo.softDeleteOffers(courseId, goneOffers, fetchedAt);
    softDeleted.offers += goneOffers.length;
  }

  // A whole course that's gone from the site (only knowable from a full, unfiltered list).
  if (!onlyIds) {
    const liveCourses = await repo.liveCourses();
    const goneCourses = idsToSoftDelete(liveCourses.map((r) => r.kajabi_id), siteCourseIds);
    await repo.softDeleteCourses(goneCourses, fetchedAt);
    softDeleted.courses = goneCourses.length;
  }

  // Every imported course gets a Hub row (a draft until published), so its admin address has a Hub id.
  await ensureDraftCourses(repos);

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
