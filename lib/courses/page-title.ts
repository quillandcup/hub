import { cache } from "react";
import { requireCoursesPage } from "@/lib/courses/caller";
import { canOpenLessons, loadCourseView } from "@/lib/courses/member";
import { lessonContext, moduleView, type Outline } from "@/lib/courses/outline";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { createRepos } from "@/lib/data/repos";

export const COURSES_TITLE = "Courses";

/** One course view per render, shared by a course page and its `generateMetadata`. */
export const loadCachedCourseView = cache(async (slug: string) => {
  const caller = await requireCoursesPage();
  const view = await loadCourseView(createRepos(createServiceRoleClient()), slug, caller.scope);
  return { caller, view };
});

/** Most specific first, like `tabTitle`: "Lesson · Module · Course · Courses". Falls back to "Courses" when there's nothing to show. */
export async function courseTitle(slug: string, pick: (outline: Outline) => string[]): Promise<string> {
  const { view } = await loadCachedCourseView(slug);
  if (!view) return COURSES_TITLE;
  // Titles inside the course are only revealed to someone who can open it.
  const inner = view.outline && canOpenLessons(view.access) ? pick(view.outline) : [];
  return [...inner, view.course.title, COURSES_TITLE].join(" · ");
}

/** A lesson's title, then the modules it sits in, innermost first. */
export function lessonTitles(outline: Outline, lessonId: string): string[] {
  const lesson = outline.lessons.find((l) => l.id === lessonId);
  const trail = lessonContext(outline, lessonId)?.trail ?? [];
  return [...(lesson ? [lesson.title] : []), ...trail.map((t) => t.title).reverse()];
}

/** A module's title, then the modules above it, innermost first (the trail already ends with the module). */
export function moduleTitles(outline: Outline, moduleId: string): string[] {
  const found = moduleView(outline, moduleId);
  return found ? found.trail.map((t) => t.title).reverse() : [];
}
