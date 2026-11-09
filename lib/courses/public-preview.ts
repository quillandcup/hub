import type { Repos } from "@/lib/data/repos";
import { courseImageSrc } from "@/lib/courses/image-urls";
import { lessonExcerpt } from "@/lib/courses/excerpt";
import { safeUrl } from "@/lib/url";

type PreviewRepos = Pick<Repos, "courses" | "media">;

/** Pixel size of our copy of a thumbnail or cover, so a link preview can declare it (a card that knows the size is shown large). */
export interface ShareImageSize {
  width: number;
  height: number;
}

/** Null when there is no copy (Kajabi's own URL is used until the copy step has run), or it can't be read: the size is only a hint. */
async function sizeOfCopy(repos: PreviewRepos, assetId: string | null): Promise<ShareImageSize | null> {
  if (!assetId) return null;
  try {
    const asset = await repos.media.byId(assetId);
    return asset && !asset.deleted_at && asset.width && asset.height ? { width: asset.width, height: asset.height } : null;
  } catch {
    return null;
  }
}

/**
 * What anyone may see of a lesson without signing in, so a shared link can show a title, a
 * picture and a teaser ("whet the appetite"): its title, its course's title, a short excerpt and
 * its thumbnail. Never the video or the full text.
 *
 * A lesson is public only when a member could open it today: the course is live (its opening date has passed), and the lesson
 * and every module above it are open (not "coming soon", not a draft). Anything else is null, and
 * the visitor gets the login page as before. Kajabi's own lesson thumbnails are public CDN images;
 * ours are copies of those, so this exposes nothing Kajabi didn't.
 *
 * Reads with the service role, so callers must treat the result as the only thing that is safe to
 * show.
 */
export interface PublicLessonPreview {
  lessonId: string;
  title: string;
  excerpt: string | null;
  courseSlug: string;
  courseTitle: string;
  /** Our copy's path, or Kajabi's public https URL until the copy step has run; null when there is no thumbnail. */
  thumbnailSrc: string | null;
  /** Of our copy; null for Kajabi's URL or when unknown. */
  thumbnailSize: ShareImageSize | null;
}

/** Why a lesson has no public preview, for the admin builder; "open" never appears as a reason. */
export type PreviewBlocker = "not_found" | "course_not_live" | "not_open";

export async function publicLessonPreview(
  repos: PreviewRepos,
  lessonId: string,
  opts: { slug?: string; now?: Date } = {}
): Promise<{ preview: PublicLessonPreview } | { blocked: PreviewBlocker }> {
  const lesson = await repos.courses.lessonById(lessonId);
  if (!lesson) return { blocked: "not_found" };

  const course = await repos.courses.courseById(lesson.course_id);
  if (!course || (opts.slug !== undefined && course.slug !== opts.slug)) return { blocked: "not_found" };
  if (course.is_draft) return { blocked: "course_not_live" };
  if (course.launch_at && new Date(course.launch_at).getTime() > (opts.now ?? new Date()).getTime()) return { blocked: "course_not_live" };

  if (lesson.state !== "open") return { blocked: "not_open" };
  if (lesson.module_id) {
    const modules = await repos.courses.modulesOf([lesson.course_id], { includeHidden: true });
    const byId = new Map(modules.map((m) => [m.id, m]));
    const seen = new Set<string>();
    for (let id: string | null = lesson.module_id; id; ) {
      const ancestor = byId.get(id);
      if (!ancestor || seen.has(id) || ancestor.state !== "open") return { blocked: "not_open" };
      seen.add(id);
      id = ancestor.parent_id;
    }
  }

  return {
    preview: {
      lessonId: lesson.id,
      title: lesson.title,
      // Already plain text (lessonExcerpt ran when the lesson was imported).
      excerpt: lesson.excerpt?.trim() || null,
      courseSlug: course.slug,
      courseTitle: course.title,
      thumbnailSrc: lesson.thumbnail_asset_id ? `/api/courses/image/lesson/${lesson.id}` : safeUrl(lesson.thumbnail_url),
      thumbnailSize: await sizeOfCopy(repos, lesson.thumbnail_asset_id),
    },
  };
}

/**
 * What anyone may see of a course without signing in: its title, a short plain-text teaser of its
 * description and its cover. Never its lessons. Public under the same rule as a lesson's course: the course is
 * published and its opening date has passed.
 */
export interface PublicCoursePreview {
  courseId: string;
  slug: string;
  title: string;
  excerpt: string | null;
  /** Our copy's path, or Kajabi's public https URL until the copy step has run; null when there is no cover. */
  thumbnailSrc: string | null;
  /** Of our copy; null for Kajabi's URL or when unknown. */
  thumbnailSize: ShareImageSize | null;
}

export type CoursePreviewBlocker = Exclude<PreviewBlocker, "not_open">;

async function previewOfCourse(
  repos: PreviewRepos,
  find: () => ReturnType<PreviewRepos["courses"]["courseById"]>,
  now: Date
): Promise<{ preview: PublicCoursePreview } | { blocked: CoursePreviewBlocker }> {
  const course = await find();
  if (!course) return { blocked: "not_found" };
  if (course.is_draft) return { blocked: "course_not_live" };
  if (course.launch_at && new Date(course.launch_at).getTime() > now.getTime()) return { blocked: "course_not_live" };
  return {
    preview: {
      courseId: course.id,
      slug: course.slug,
      title: course.title,
      excerpt: lessonExcerpt(course.description),
      thumbnailSrc: courseImageSrc("course", course.id, course.thumbnail_asset_id, course.thumbnail_url),
      thumbnailSize: await sizeOfCopy(repos, course.thumbnail_asset_id),
    },
  };
}

export function publicCoursePreview(repos: PreviewRepos, slug: string, opts: { now?: Date } = {}) {
  return previewOfCourse(repos, () => repos.courses.courseBySlug(slug), opts.now ?? new Date());
}

/** The same check by id, for the cover image route. */
export function publicCoursePreviewById(repos: PreviewRepos, courseId: string, opts: { now?: Date } = {}) {
  return previewOfCourse(repos, () => repos.courses.courseById(courseId), opts.now ?? new Date());
}
