import type { SupabaseClient } from "@supabase/supabase-js";
import { createRepos } from "@/lib/data/repos";
import { fetchAll } from "@/lib/courses/db";
import { explainCourse, type ExplainedCourse } from "@/lib/courses/explain";
import { resolveCourseAccess } from "@/lib/courses/member";
import { fetchAllBronzeRows } from "@/lib/supabase/bronze-pagination";
import { slugifyTitle } from "@/lib/courses/visibility";
import { planCourseVideos, type PlannedVideo } from "@/lib/courses/media";
import { planCourseFiles, type FilePlan } from "@/lib/courses/files";

/**
 * What the admin Courses page reads: every Kajabi course with its Hub state (published or not,
 * its settings, who has access) and, for one course, why each module and lesson is open, coming
 * soon or hidden. Reads with the signed-in admin's own client: admins can read the Bronze and
 * Silver course tables (but not write them; writes go through the course routes).
 */

export interface AccessCounts {
  current: number;
  upcoming: number;
  ended: number;
}

export interface AdminCourseRow {
  kajabiId: string;
  title: string;
  /** Null until the course is published in the Hub. */
  published: { slug: string; accessDuration: string | null; launchAt: string | null } | null;
  /** The slug publishing would use. */
  slug: string;
  access: AccessCounts;
  totals: ExplainedCourse["totals"];
}

function countAccess(rows: { starts_at: string; ends_at: string | null }[], now: Date): AccessCounts {
  const counts: AccessCounts = { current: 0, upcoming: 0, ended: 0 };
  for (const row of rows) {
    const kind = resolveCourseAccess(row, false, now).kind;
    if (kind === "open") counts.current++;
    else if (kind === "upcoming") counts.upcoming++;
    else if (kind === "ended") counts.ended++;
  }
  return counts;
}

const toModules = (rows: any[]) =>
  rows.map((m) => ({ kajabiId: m.kajabi_id, parentKajabiId: m.parent_kajabi_id, position: m.position, title: m.title, publishingOption: m.publishing_option }));
const toLessons = (rows: any[]) =>
  rows.map((l) => ({ kajabiId: l.kajabi_id, moduleKajabiId: l.module_kajabi_id, position: l.position, title: l.title, publishingOption: l.publishing_option }));

async function loadSilverCourses(supabase: SupabaseClient) {
  return fetchAll(supabase, "courses", "id, slug, source_key, access_duration, launch_at", (q) => q.eq("source", "kajabi"));
}

export async function loadAdminCourses(supabase: SupabaseClient, now = new Date()): Promise<AdminCourseRow[]> {
  const [bronze, silver, modules, lessons] = await Promise.all([
    fetchAllBronzeRows(supabase, "kajabi_courses", "kajabi_id, title", (q) => q.is("deleted_at", null)),
    loadSilverCourses(supabase),
    fetchAllBronzeRows(supabase, "kajabi_course_modules", "kajabi_id, course_kajabi_id, parent_kajabi_id, position, title, publishing_option", (q) => q.is("deleted_at", null)),
    fetchAllBronzeRows(supabase, "kajabi_course_lessons", "kajabi_id, course_kajabi_id, module_kajabi_id, position, title, publishing_option", (q) => q.is("deleted_at", null)),
  ]);
  const silverByKey = new Map(silver.map((c) => [c.source_key, c]));
  const access = silver.length
    ? await fetchAll(supabase, "course_access", "course_id, starts_at, ends_at", (q) => q.in("course_id", silver.map((c) => c.id)))
    : [];

  return bronze
    .map((c) => {
      const s = silverByKey.get(c.kajabi_id);
      const explained = explainCourse(
        toModules(modules.filter((m) => m.course_kajabi_id === c.kajabi_id)),
        toLessons(lessons.filter((l) => l.course_kajabi_id === c.kajabi_id))
      );
      return {
        kajabiId: c.kajabi_id,
        title: c.title,
        published: s ? { slug: s.slug, accessDuration: s.access_duration, launchAt: s.launch_at } : null,
        slug: s?.slug ?? slugifyTitle(c.title),
        access: s ? countAccess(access.filter((a) => a.course_id === s.id), now) : { current: 0, upcoming: 0, ended: 0 },
        totals: explained.totals,
      };
    })
    .sort((a, b) => Number(!!b.published) - Number(!!a.published) || a.title.localeCompare(b.title));
}

export interface AdminCourseDetail {
  course: AdminCourseRow;
  explained: ExplainedCourse;
  /** Per lesson, whether step B has fetched its text and found a video (keyed by Kajabi lesson id). */
  content: Record<string, { hasText: boolean; hasVideo: boolean }>;
  /** Kajabi lesson id -> the Hub lesson id, for lessons that are in the Hub (published course; drafts are stored too, as hidden). */
  hubLessonIds: Record<string, string>;
  /** Each distinct video of a visible lesson, and what step D would do with it. */
  videos: PlannedVideo[];
  /** Each download of a visible lesson, what is already copied, and what would be removed. */
  files: FilePlan;
  /** The fields the builder shows (read only for now); null where the course isn't in the Hub yet. */
  details: { description: string | null; includesMembership: boolean | null };
  /** When Kajabi's structure for this course was last imported (the newest row's fetch time), or null. */
  lastImportedAt: string | null;
}

export async function loadAdminCourse(supabase: SupabaseClient, kajabiId: string, now = new Date()): Promise<AdminCourseDetail | null> {
  const { data: bronze, error } = await supabase.schema("bronze").from("kajabi_courses").select("kajabi_id, title, fetched_at").eq("kajabi_id", kajabiId).is("deleted_at", null).maybeSingle();
  if (error) throw new Error(`kajabi_courses read failed: ${error.message}`);
  if (!bronze) return null;

  const [modules, lessons, rows, videos, files] = await Promise.all([
    fetchAllBronzeRows(supabase, "kajabi_course_modules", "kajabi_id, parent_kajabi_id, position, title, publishing_option, fetched_at", (q) => q.eq("course_kajabi_id", kajabiId).is("deleted_at", null)),
    fetchAllBronzeRows(supabase, "kajabi_course_lessons", "kajabi_id, module_kajabi_id, position, title, publishing_option, video_media_id, content_fetched_at, fetched_at", (q) => q.eq("course_kajabi_id", kajabiId).is("deleted_at", null)),
    loadAdminCourses(supabase, now),
    planCourseVideos(supabase, kajabiId, now),
    planCourseFiles(supabase, kajabiId, now),
  ]);
  const course = rows.find((r) => r.kajabiId === kajabiId);
  if (!course) return null;

  let hubLessonIds: Record<string, string> = {};
  let details: AdminCourseDetail["details"] = { description: null, includesMembership: null };
  if (course.published) {
    const { data: silver } = await supabase.from("courses").select("id, description, program_id").eq("source", "kajabi").eq("source_key", kajabiId).maybeSingle();
    if (silver) {
      const hub = await fetchAll(supabase, "course_lessons", "id, source_key", (q) => q.eq("course_id", silver.id).eq("source", "kajabi"));
      hubLessonIds = Object.fromEntries(hub.map((l) => [l.source_key, l.id]));
      let includesMembership: boolean | null = null;
      if (silver.program_id) {
        const program = await createRepos(supabase).programs.byId(silver.program_id);
        includesMembership = program?.includes_membership ?? null;
      }
      details = { description: silver.description ?? null, includesMembership };
    }
  }

  const fetchTimes = [bronze.fetched_at, ...modules.map((m) => m.fetched_at), ...lessons.map((l) => l.fetched_at)].filter((t): t is string => !!t);
  const lastImportedAt = fetchTimes.reduce<string | null>((newest, t) => (!newest || Date.parse(t) > Date.parse(newest) ? t : newest), null);

  return {
    course,
    hubLessonIds,
    videos,
    files,
    details,
    lastImportedAt,
    explained: explainCourse(toModules(modules), toLessons(lessons)),
    content: Object.fromEntries(lessons.map((l) => [l.kajabi_id, { hasText: l.content_fetched_at !== null, hasVideo: l.video_media_id !== null }])),
  };
}
