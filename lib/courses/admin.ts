import type { SupabaseClient } from "@supabase/supabase-js";
import { createRepos } from "@/lib/data/repos";
import { fetchAll } from "@/lib/courses/db";
import { explainCourse, type ExplainedCourse, type ExplainedLesson } from "@/lib/courses/explain";
import { sanitizeLessonHtml } from "@/lib/courses/sanitize";
import { courseImageSrc, courseImageUrl } from "@/lib/courses/image-urls";
import { resolveCourseAccess } from "@/lib/courses/member";
import { fetchAllBronzeRows } from "@/lib/supabase/bronze-pagination";
import { slugifyTitle, type Visibility } from "@/lib/courses/visibility";
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

/** A course's title for the browser tab, without loading the rest of the page. Null for a course Kajabi doesn't have. */
export async function loadAdminCourseTitle(supabase: SupabaseClient, kajabiId: string): Promise<string | null> {
  const { data, error } = await supabase.schema("bronze").from("kajabi_courses").select("title").eq("kajabi_id", kajabiId).is("deleted_at", null).maybeSingle();
  if (error) throw new Error(`kajabi_courses read failed: ${error.message}`);
  return data?.title ?? null;
}

export interface AdminLessonDetail {
  course: { kajabiId: string; title: string };
  lesson: {
    kajabiId: string;
    title: string;
    publishingOption: string | null;
    state: Visibility;
    reason: string;
    /** Allowlist-sanitized (never Kajabi's raw HTML); null until the content step has fetched it. */
    bodyHtml: string | null;
    /** Our copy's path when the copy step has run, else Kajabi's URL (http(s) only). */
    thumbnailSrc: string | null;
    videoDurationSeconds: number | null;
    hasVideo: boolean;
    contentFetchedAt: string | null;
    fetchedAt: string;
  };
  /** The modules the lesson sits in, outermost first. */
  trail: { kajabiId: string; title: string; publishingOption: string | null }[];
  /** Every module of the course as a path ("Module 2 / Week 1"), for the module picker. */
  modules: { kajabiId: string; path: string }[];
  files: { filename: string; sizeBytes: number | null }[];
  /** The lesson in the Hub, when the course is published there. */
  hub: { slug: string; lessonId: string } | null;
  /** The lesson's video in the Hub (what plays), when it has one. */
  video: { status: string; playbackId: string | null } | null;
}

/** One lesson for its builder page: Kajabi's data as last imported, with the state members get. Null when the course or lesson isn't there. */
export async function loadAdminLesson(supabase: SupabaseClient, courseKajabiId: string, lessonKajabiId: string): Promise<AdminLessonDetail | null> {
  const bronze = supabase.schema("bronze");
  const [course, lessonRow, modules, lessons, files] = await Promise.all([
    bronze.from("kajabi_courses").select("kajabi_id, title").eq("kajabi_id", courseKajabiId).is("deleted_at", null).maybeSingle(),
    bronze
      .from("kajabi_course_lessons")
      .select("kajabi_id, title, publishing_option, body_html, thumbnail_url, video_media_id, video_duration_seconds, content_fetched_at, fetched_at")
      .eq("kajabi_id", lessonKajabiId)
      .eq("course_kajabi_id", courseKajabiId)
      .is("deleted_at", null)
      .maybeSingle(),
    fetchAllBronzeRows(supabase, "kajabi_course_modules", "kajabi_id, parent_kajabi_id, position, title, publishing_option", (q) => q.eq("course_kajabi_id", courseKajabiId).is("deleted_at", null)),
    fetchAllBronzeRows(supabase, "kajabi_course_lessons", "kajabi_id, module_kajabi_id, position, title, publishing_option", (q) => q.eq("course_kajabi_id", courseKajabiId).is("deleted_at", null)),
    bronze.from("kajabi_lesson_files").select("filename, size_bytes, kajabi_id").eq("lesson_kajabi_id", lessonKajabiId).is("deleted_at", null).order("filename").order("kajabi_id"),
  ]);
  for (const r of [course, lessonRow, files]) if (r.error) throw new Error(`course lesson read failed: ${r.error.message}`);
  if (!course.data || !lessonRow.data) return null;
  const l = lessonRow.data;

  const explained = explainCourse(toModules(modules), toLessons(lessons));
  const flat: ExplainedLesson[] = [...explained.loose];
  const walk = (ms: typeof explained.modules) => ms.forEach((m) => (flat.push(...m.lessons), walk(m.children)));
  walk(explained.modules);
  const explainedLesson = flat.find((x) => x.kajabiId === lessonKajabiId);
  if (!explainedLesson) return null;

  const byId = new Map(modules.map((m) => [m.kajabi_id as string, m]));
  const trailOf = (moduleId: string | null) => {
    const trail: AdminLessonDetail["trail"] = [];
    for (let id = moduleId, seen = new Set<string>(); id && byId.has(id) && !seen.has(id); ) {
      seen.add(id);
      const m = byId.get(id)!;
      trail.unshift({ kajabiId: m.kajabi_id, title: m.title, publishingOption: m.publishing_option });
      id = m.parent_kajabi_id;
    }
    return trail;
  };
  const own = lessons.find((x) => x.kajabi_id === lessonKajabiId);

  let hub: AdminLessonDetail["hub"] = null;
  let video: AdminLessonDetail["video"] = null;
  let thumbnailSrc = courseImageUrl(l.thumbnail_url);
  const { data: silver } = await supabase.from("courses").select("id, slug").eq("source", "kajabi").eq("source_key", courseKajabiId).maybeSingle();
  if (silver) {
    const { data: hubLesson } = await supabase.from("course_lessons").select("id, thumbnail_asset_id, video_id").eq("course_id", silver.id).eq("source", "kajabi").eq("source_key", lessonKajabiId).maybeSingle();
    if (hubLesson) {
      hub = { slug: silver.slug, lessonId: hubLesson.id };
      if (hubLesson.video_id) {
        const { data: v, error: videoError } = await supabase.from("videos").select("status, mux_playback_id").eq("id", hubLesson.video_id).maybeSingle();
        if (videoError) throw new Error(`videos read failed: ${videoError.message}`);
        if (v) video = { status: v.status, playbackId: v.mux_playback_id };
      }
      thumbnailSrc = courseImageSrc("lesson", hubLesson.id, hubLesson.thumbnail_asset_id, l.thumbnail_url);
    }
  }

  return {
    course: { kajabiId: course.data.kajabi_id, title: course.data.title },
    lesson: {
      kajabiId: l.kajabi_id,
      title: l.title,
      publishingOption: l.publishing_option,
      state: explainedLesson.state,
      reason: explainedLesson.reason,
      bodyHtml: sanitizeLessonHtml(l.body_html),
      thumbnailSrc,
      videoDurationSeconds: l.video_duration_seconds,
      hasVideo: l.video_media_id !== null,
      contentFetchedAt: l.content_fetched_at,
      fetchedAt: l.fetched_at,
    },
    trail: trailOf(own?.module_kajabi_id ?? null),
    modules: modules
      .map((m) => ({ kajabiId: m.kajabi_id as string, path: trailOf(m.kajabi_id).map((t) => t.title).join(" / ") }))
      .sort((a, b) => a.path.localeCompare(b.path)),
    files: (files.data ?? []).map((f) => ({ filename: f.filename, sizeBytes: f.size_bytes })),
    hub,
    video,
  };
}
