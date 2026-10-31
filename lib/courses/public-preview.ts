import type { SupabaseClient } from "@supabase/supabase-js";
import { isFeatureOnForEveryone } from "@/lib/features.server";
import { safeUrl } from "@/lib/url";

/**
 * What anyone may see of a lesson without signing in, so a shared link can show a title, a
 * picture and a teaser ("whet the appetite"): its title, its course's title, a short excerpt and
 * its thumbnail. Never the video or the full text.
 *
 * A lesson is public only when a member could open it today: the `courses` feature is on for
 * everyone (not just a segment), the course is live (its opening date has passed), and the lesson
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
}

/** Why a lesson has no public preview, for the admin builder; "open" never appears as a reason. */
export type PreviewBlocker = "feature_off" | "not_found" | "course_not_live" | "not_open";

export async function publicLessonPreview(
  supabase: SupabaseClient,
  lessonId: string,
  opts: { slug?: string; now?: Date } = {}
): Promise<{ preview: PublicLessonPreview } | { blocked: PreviewBlocker }> {
  if (!(await isFeatureOnForEveryone(supabase, "courses"))) return { blocked: "feature_off" };

  const { data: lesson, error } = await supabase
    .from("course_lessons")
    .select("id, title, excerpt, state, module_id, course_id, thumbnail_asset_id, thumbnail_url")
    .eq("id", lessonId)
    .maybeSingle();
  if (error) throw new Error(`course_lessons read failed: ${error.message}`);
  if (!lesson) return { blocked: "not_found" };

  const { data: course, error: courseError } = await supabase.from("courses").select("slug, title, launch_at").eq("id", lesson.course_id).maybeSingle();
  if (courseError) throw new Error(`courses read failed: ${courseError.message}`);
  if (!course || (opts.slug !== undefined && course.slug !== opts.slug)) return { blocked: "not_found" };
  if (course.launch_at && new Date(course.launch_at).getTime() > (opts.now ?? new Date()).getTime()) return { blocked: "course_not_live" };

  if (lesson.state !== "open") return { blocked: "not_open" };
  if (lesson.module_id) {
    const { data: modules, error: moduleError } = await supabase.from("course_modules").select("id, parent_id, state").eq("course_id", lesson.course_id);
    if (moduleError) throw new Error(`course_modules read failed: ${moduleError.message}`);
    const byId = new Map((modules ?? []).map((m) => [m.id as string, m]));
    const seen = new Set<string>();
    for (let id: string | null = lesson.module_id; id; ) {
      const module = byId.get(id);
      if (!module || seen.has(id) || module.state !== "open") return { blocked: "not_open" };
      seen.add(id);
      id = module.parent_id;
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
    },
  };
}
