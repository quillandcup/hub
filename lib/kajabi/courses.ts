import type { KajabiCourseResource, KajabiCourseResponse } from "@/lib/kajabi/client";

/**
 * Kajabi course structure -> Bronze rows (docs/COURSES.md, step A).
 *
 * Pure: no I/O. The OpenAPI spec doesn't document how included modules and lessons point at
 * their parents, so parents are resolved from either side (a lesson's `module`/`category`
 * relationship, or a module's `lessons` list; a module's `parent_module`), and the counts of
 * anything left unplaced are reported so a surprise in the live response shows up in the import
 * result instead of silently flattening the course.
 */

export interface ParsedCourse {
  course: { kajabiId: string; title: string; description: string | null; raw: KajabiCourseResource };
  modules: ParsedModule[];
  lessons: ParsedLesson[];
  offers: { kajabiId: string; title: string | null }[];
  /** Lessons whose module couldn't be resolved from the response. */
  unplacedLessons: number;
}

export interface ParsedModule {
  kajabiId: string;
  parentKajabiId: string | null;
  position: number | null;
  title: string;
  publishingOption: string | null;
  posterUrl: string | null;
  raw: KajabiCourseResource;
}

export interface ParsedLesson {
  kajabiId: string;
  moduleKajabiId: string | null;
  position: number | null;
  title: string;
  publishingOption: string | null;
  videoDurationSeconds: number | null;
  raw: KajabiCourseResource;
}

function relatedIds(resource: KajabiCourseResource, ...names: string[]): string[] {
  for (const name of names) {
    const data = resource.relationships?.[name]?.data;
    if (!data) continue;
    return (Array.isArray(data) ? data : [data]).map((d) => String(d.id));
  }
  return [];
}

function toPosition(value: unknown): number | null {
  const n = typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(n) ? n : null;
}

export function parseKajabiCourse(response: KajabiCourseResponse): ParsedCourse {
  const data = response?.data;
  if (!data?.id) throw new Error("Kajabi course response has no data.id");

  const included = response.included ?? [];
  const byType = (type: string) => included.filter((r) => r.type === type);
  const moduleResources = byType("modules");
  const lessonResources = byType("lessons");
  const mediaById = new Map(byType("media").map((m) => [String(m.id), m]));
  const moduleIds = new Set(moduleResources.map((m) => String(m.id)));

  // A module's lessons, for the case where only that side of the relationship is filled in.
  const moduleByLessonFromModules = new Map<string, string>();
  for (const m of moduleResources) {
    for (const lessonId of relatedIds(m, "lessons")) moduleByLessonFromModules.set(lessonId, String(m.id));
  }

  const modules: ParsedModule[] = moduleResources.map((m) => {
    const parent = relatedIds(m, "parent_module", "parent")[0] ?? null;
    return {
      kajabiId: String(m.id),
      parentKajabiId: parent && moduleIds.has(parent) ? parent : null,
      position: toPosition(m.attributes.position),
      title: String(m.attributes.title ?? ""),
      publishingOption: m.attributes.publishing_option ?? null,
      posterUrl: m.attributes.poster_image_url ?? null,
      raw: m,
    };
  });

  let unplacedLessons = 0;
  const lessons: ParsedLesson[] = lessonResources.map((l) => {
    const own = relatedIds(l, "module", "category", "parent_module")[0];
    const moduleId = [own, moduleByLessonFromModules.get(String(l.id))].find((id) => id && moduleIds.has(id)) ?? null;
    if (!moduleId && moduleIds.size > 0) unplacedLessons++;
    const media = relatedIds(l, "media").map((id) => mediaById.get(id)).find(Boolean);
    const minutes = media?.attributes?.duration_in_minutes;
    return {
      kajabiId: String(l.id),
      moduleKajabiId: moduleId,
      position: toPosition(l.attributes.position),
      title: String(l.attributes.title ?? ""),
      publishingOption: l.attributes.publishing_option ?? null,
      videoDurationSeconds: typeof minutes === "number" ? Math.round(minutes * 60) : null,
      raw: l,
    };
  });

  const offers = byType("offers").map((o) => ({
    kajabiId: String(o.id),
    title: (o.attributes?.name ?? o.attributes?.title ?? null) as string | null,
  }));

  return {
    course: {
      kajabiId: String(data.id),
      title: String(data.attributes?.title ?? ""),
      description: data.attributes?.description ?? null,
      raw: data,
    },
    modules,
    lessons,
    offers,
    unplacedLessons,
  };
}

/** Ids that were live and a complete fetch no longer returns: the ones to soft-delete. */
export function idsToSoftDelete(liveIds: Iterable<string>, fetchedIds: Iterable<string>): string[] {
  const fetched = new Set(fetchedIds);
  return Array.from(liveIds).filter((id) => !fetched.has(id));
}
