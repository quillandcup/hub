import type { Repos } from "@/lib/data/repos";

/**
 * What taking a course over from Kajabi would change, worked out without changing anything (the dry run the
 * confirmation shows). Taking over turns an imported course into one the Hub owns (`take_over_kajabi_course`,
 * migration 20270415000000): the ids, videos, downloads and members' access and progress stay as they are.
 */
export interface TakeOverPreview {
  modules: number;
  lessons: number;
  /** Lessons that have text / a video. */
  withText: number;
  withVideo: number;
  /** Downloads copied into the Hub. */
  downloads: number;
  /** Items with no setting in Kajabi (or one the editor doesn't use): they become drafts, which members see them as already. */
  withoutSetting: number;
  /** Modules nested deeper than the editor does (a module has submodules, a submodule has lessons only): the course can't be taken over yet. */
  tooDeep: boolean;
}

const KNOWN_SETTINGS = new Set(["draft", "published", "scheduled", "drip", "locked"]);

/** The preview for an imported course, or null for an unknown course or one the Hub already owns. */
export async function loadTakeOverPreview(repos: Pick<Repos, "courses">, courseId: string): Promise<TakeOverPreview | null> {
  const course = await repos.courses.courseById(courseId);
  if (!course || course.source !== "kajabi") return null;
  const [modules, lessons] = await Promise.all([repos.courses.modulesOf([courseId], { includeHidden: true }), repos.courses.lessonsOf([courseId], { includeHidden: true })]);
  const files = await repos.courses.filesOfLessons(lessons.map((l) => l.id));

  const parentOf = new Map(modules.map((m) => [m.id, m.parent_id]));
  return {
    modules: modules.length,
    lessons: lessons.length,
    withText: lessons.filter((l) => l.excerpt !== null).length,
    withVideo: lessons.filter((l) => l.video_id !== null).length,
    downloads: files.length,
    withoutSetting: [...modules, ...lessons].filter((i) => !i.publishing_option || !KNOWN_SETTINGS.has(i.publishing_option)).length,
    tooDeep: modules.some((m) => m.parent_id && parentOf.get(m.parent_id)),
  };
}
