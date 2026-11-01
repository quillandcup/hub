import type { Repos } from "@/lib/data/repos";
import type { LessonRecord } from "@/lib/data/courses";
import { isId } from "@/lib/ids";
import { resolveCourseParam } from "@/lib/courses/course-param";
import { buildHubOutline, type HubOutline } from "@/lib/courses/hub-outline";
import { explainCourse, type ExplainedCourse, type ExplainedLesson } from "@/lib/courses/explain";
import { sanitizeLessonHtml } from "@/lib/courses/sanitize";
import { courseImageSrc, courseImageUrl } from "@/lib/courses/image-urls";
import { resolveCourseAccess } from "@/lib/courses/member";
import { slugifyTitle, type Visibility } from "@/lib/courses/visibility";
import { planCourseVideos, type PlannedVideo } from "@/lib/courses/media";
import { planCourseFiles, type FilePlan } from "@/lib/courses/files";

type AdminCourseRepos = Pick<Repos, "courseProgress" | "courses" | "kajabiCourses" | "programs">;

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
  /** Where the course lives: imported from Kajabi (read only here) or owned by the Hub (editable). */
  source: "kajabi" | "hub";
  /** The course's Hub id (what the admin page's address takes); null until the Kajabi import has made its row. */
  id: string | null;
  title: string;
  /** Not available to members yet. Independent of `source`: any course, imported or Hub-owned, is a draft until published. */
  isDraft: boolean;
  /** The course's Hub settings; null until the Kajabi import has made its row. */
  hub: { slug: string; accessDuration: string | null; launchAt: string | null } | null;
  /** The slug the course has, or would get. */
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


export async function loadAdminCourses(repos: AdminCourseRepos, now = new Date()): Promise<AdminCourseRow[]> {
  const repo = repos.kajabiCourses;
  const [bronze, silver, modules, lessons] = await Promise.all([
    repo.liveCourses(),
    repos.courses.courses({ source: "kajabi" }),
    repo.liveModules(),
    repo.liveLessonOutlines(),
  ]);
  const silverByKey = new Map(silver.map((c) => [c.source_key, c]));
  const access = await repos.courseProgress.accessOfCourses(silver.map((c) => c.id));

  const imported: AdminCourseRow[] = bronze
    .map((c) => {
      const s = silverByKey.get(c.kajabi_id);
      const explained = explainCourse(
        toModules(modules.filter((m) => m.course_kajabi_id === c.kajabi_id)),
        toLessons(lessons.filter((l) => l.course_kajabi_id === c.kajabi_id))
      );
      return {
        source: "kajabi" as const,
        id: s?.id ?? null,
        title: c.title,
        isDraft: s?.is_draft ?? true,
        hub: s ? { slug: s.slug, accessDuration: s.access_duration, launchAt: s.launch_at } : null,
        slug: s?.slug ?? slugifyTitle(c.title),
        access: s ? countAccess(access.filter((a) => a.course_id === s.id), now) : { current: 0, upcoming: 0, ended: 0 },
        totals: explained.totals,
      };
    });
  return [...imported, ...(await loadHubCourseRows(repos, now))].sort((a, b) => Number(a.isDraft) - Number(b.isDraft) || a.title.localeCompare(b.title));
}

/** The Hub-owned courses, shaped like the imported ones for the list. */
async function loadHubCourseRows(repos: AdminCourseRepos, now: Date): Promise<AdminCourseRow[]> {
  const courses = await repos.courses.courses({ source: "hub" });
  if (courses.length === 0) return [];
  const ids = courses.map((c) => c.id);
  const [access, lessons] = await Promise.all([repos.courseProgress.accessOfCourses(ids), repos.courses.lessonsOf(ids, { includeHidden: true })]);
  return courses.map((c) => {
    const totals: ExplainedCourse["totals"] = { open: 0, coming_soon: 0, hidden: 0 };
    for (const l of lessons) if (l.course_id === c.id && l.state in totals) totals[l.state as Visibility]++;
    return {
      source: "hub" as const,
      id: c.id,
      title: c.title,
      isDraft: c.is_draft,
      hub: { slug: c.slug, accessDuration: c.access_duration, launchAt: c.launch_at },
      slug: c.slug,
      access: countAccess(access.filter((a) => a.course_id === c.id), now),
      totals,
    };
  });
}

export interface HubCourseDetail {
  id: string;
  title: string;
  slug: string;
  description: string | null;
  /** As stored (ISO 8601 or Postgres text), null = lifetime. */
  accessDuration: string | null;
  launchAt: string | null;
  programId: string | null;
  /** Not available to members yet. */
  isDraft: boolean;
  access: AccessCounts;
}

/** One Hub-owned course for its page; null for an unknown id or a course imported from Kajabi. */
export async function loadHubCourse(repos: AdminCourseRepos, id: string, now = new Date()): Promise<HubCourseDetail | null> {
  const data = await repos.courses.courseById(id);
  if (!data || data.source !== "hub") return null;
  const access = await repos.courseProgress.accessOfCourses([id]);
  return {
    id: data.id,
    title: data.title,
    slug: data.slug,
    description: data.description,
    accessDuration: data.access_duration,
    launchAt: data.launch_at,
    programId: data.program_id,
    isDraft: data.is_draft,
    access: countAccess(access, now),
  };
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

/** The Kajabi id behind a Hub course id, or null for an unknown id or a Hub-owned course. The Kajabi id never leaves the server. */
export async function kajabiIdOfCourse(repos: AdminCourseRepos, courseId: string): Promise<string | null> {
  if (!isId(courseId, "crs")) return null;
  const course = await repos.courses.courseById(courseId);
  return course?.source === "kajabi" ? course.source_key : null;
}

export async function loadAdminCourse(repos: AdminCourseRepos, courseParam: string, now = new Date()): Promise<AdminCourseDetail | null> {
  const courseId = await resolveCourseParam(repos, courseParam);
  const kajabiId = await kajabiIdOfCourse(repos, courseId);
  if (!kajabiId) return null;
  const repo = repos.kajabiCourses;
  const bronze = await repo.liveCourse(kajabiId);
  if (!bronze) return null;

  const [modules, lessons, rows, videos, files] = await Promise.all([
    repo.liveModules(kajabiId),
    repo.liveLessonOutlines(kajabiId),
    loadAdminCourses(repos, now),
    planCourseVideos(repos, kajabiId, now),
    planCourseFiles(repos, kajabiId, now),
  ]);
  const course = rows.find((r) => r.id === courseId);
  if (!course) return null;

  let hubLessonIds: Record<string, string> = {};
  let details: AdminCourseDetail["details"] = { description: null, includesMembership: null };
  if (course.hub) {
    const silver = await repos.courses.courseById(courseId);
    if (silver) {
      const hub = await repos.courses.lessonsOf([silver.id], { source: "kajabi", includeHidden: true });
      hubLessonIds = Object.fromEntries(hub.flatMap((l) => (l.source_key ? [[l.source_key, l.id]] : [])));
      let includesMembership: boolean | null = null;
      if (silver.program_id) {
        const program = await repos.programs.byId(silver.program_id);
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

/** A course's title for the browser tab, without loading the rest of the page. Null for an unknown id. */
export async function loadAdminCourseTitle(repos: AdminCourseRepos, courseParam: string): Promise<string | null> {
  const courseId = await resolveCourseParam(repos, courseParam);
  if (!isId(courseId, "crs")) return null;
  return (await repos.courses.courseById(courseId))?.title ?? null;
}

export interface AdminLessonDetail {
  course: { id: string; title: string };
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
  /** The lesson is in a Hub-owned course: its setting and title can be changed here. An imported lesson is shown as Kajabi has it. */
  editable: boolean;
}

/** One lesson for its builder page: Kajabi's data as last imported, with the state members get. Null when the course or lesson isn't there. */
export async function loadAdminLesson(repos: AdminCourseRepos, courseParam: string, lessonId: string): Promise<AdminLessonDetail | null> {
  const courseId = await resolveCourseParam(repos, courseParam);
  if (!isId(courseId, "crs") || !isId(lessonId, "les")) return null;
  const found = await repos.courses.lessonById(lessonId);
  if (found && found.course_id === courseId && found.source === "hub") return loadHubLesson(repos, courseId, found);
  const courseKajabiId = await kajabiIdOfCourse(repos, courseId);
  if (!courseKajabiId) return null;
  const hubLesson = found && found.course_id === courseId && found.source === "kajabi" ? found : null;
  const lessonKajabiId = hubLesson?.source_key;
  if (!hubLesson || !lessonKajabiId) return null;
  const repo = repos.kajabiCourses;
  const [course, l, modules, lessons, files] = await Promise.all([
    repo.liveCourse(courseKajabiId),
    repo.liveLesson(courseKajabiId, lessonKajabiId),
    repo.liveModules(courseKajabiId),
    repo.liveLessonOutlines(courseKajabiId),
    repo.liveFiles([lessonKajabiId]),
  ]);
  if (!course || !l) return null;

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
  const silver = await repos.courses.courseById(courseId);
  if (silver) {
    hub = { slug: silver.slug, lessonId: hubLesson.id };
    if (hubLesson.video_id) {
      const v = (await repos.courses.videosByIds([hubLesson.video_id]))[0];
      if (v) video = { status: v.status, playbackId: v.mux_playback_id };
    }
    thumbnailSrc = courseImageSrc("lesson", hubLesson.id, hubLesson.thumbnail_asset_id, l.thumbnail_url);
  }

  return {
    course: { id: courseId, title: course.title },
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
    files: files.map((f) => ({ filename: f.filename, sizeBytes: f.size_bytes })),
    hub,
    video,
    editable: false,
  };
}

/** One lesson of a Hub-owned course, from the Hub's own rows: nothing of it comes from Kajabi. */
async function loadHubLesson(repos: AdminCourseRepos, courseId: string, lesson: LessonRecord): Promise<AdminLessonDetail | null> {
  const [course, modules, lessons, body, files] = await Promise.all([
    repos.courses.courseById(courseId),
    repos.courses.modulesOf([courseId], { includeHidden: true }),
    repos.courses.lessonsOf([courseId], { includeHidden: true }),
    repos.courses.lessonBody(lesson.id),
    repos.courses.lessonFiles(lesson.id),
  ]);
  if (!course || course.source !== "hub") return null;

  const outline = buildHubOutline(
    modules.map((m) => ({ id: m.id, parent_id: m.parent_id, title: m.title, position: m.position, publishing_option: m.publishing_option })),
    lessons.map((l) => ({ id: l.id, module_id: l.module_id, title: l.title, position: l.position, publishing_option: l.publishing_option, hasText: false, hasVideo: false }))
  );
  const flat: ExplainedLesson[] = [...outline.loose];
  const walk = (ms: typeof outline.modules) => ms.forEach((m) => (flat.push(...m.lessons), walk(m.children)));
  walk(outline.modules);
  const explained = flat.find((x) => x.kajabiId === lesson.id);
  if (!explained) return null;

  const byId = new Map(modules.map((m) => [m.id, m]));
  const trailOf = (moduleId: string | null) => {
    const trail: AdminLessonDetail["trail"] = [];
    for (let id = moduleId, seen = new Set<string>(); id && byId.has(id) && !seen.has(id); ) {
      seen.add(id);
      const m = byId.get(id)!;
      trail.unshift({ kajabiId: m.id, title: m.title, publishingOption: m.publishing_option });
      id = m.parent_id;
    }
    return trail;
  };

  let video: AdminLessonDetail["video"] = null;
  if (lesson.video_id) {
    const v = (await repos.courses.videosByIds([lesson.video_id]))[0];
    if (v) video = { status: v.status, playbackId: v.mux_playback_id };
  }
  return {
    course: { id: courseId, title: course.title },
    // The id goes in `kajabiId`, as in the Hub outline: the page's rows are keyed by it and a Hub-owned item has no Kajabi id.
    lesson: {
      kajabiId: lesson.id,
      title: lesson.title,
      publishingOption: lesson.publishing_option,
      state: explained.state,
      reason: explained.reason,
      bodyHtml: sanitizeLessonHtml(body?.body_html ?? null),
      thumbnailSrc: courseImageSrc("lesson", lesson.id, lesson.thumbnail_asset_id, lesson.thumbnail_url),
      videoDurationSeconds: lesson.duration_seconds,
      hasVideo: lesson.video_id !== null,
      contentFetchedAt: null,
      fetchedAt: lesson.updated_at,
    },
    trail: trailOf(lesson.module_id),
    modules: modules.map((m) => ({ kajabiId: m.id, path: trailOf(m.id).map((t) => t.title).join(" / ") })).sort((a, b) => a.path.localeCompare(b.path)),
    files: files.map((f) => ({ filename: f.filename, sizeBytes: f.size_bytes })),
    hub: { slug: course.slug, lessonId: lesson.id },
    video,
    editable: true,
  };
}

/** The modules and lessons of a Hub-owned course, as the builder's outline draws them. */
export async function loadHubOutline(repos: AdminCourseRepos, courseId: string): Promise<HubOutline> {
  const courses = repos.courses;
  const [modules, lessons] = await Promise.all([courses.modulesOf([courseId], { includeHidden: true }), courses.lessonsOf([courseId], { includeHidden: true })]);
  return buildHubOutline(
    modules.map((m) => ({ id: m.id, parent_id: m.parent_id, title: m.title, position: m.position, publishing_option: m.publishing_option })),
    // `excerpt` stands in for "has text": the full text is large, and the excerpt is set whenever there is some.
    lessons.map((l) => ({ id: l.id, module_id: l.module_id, title: l.title, position: l.position, publishing_option: l.publishing_option, hasText: l.excerpt !== null, hasVideo: l.video_id !== null }))
  );
}
