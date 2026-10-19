/**
 * A course's modules and lessons as members read them (docs/COURSES.md, "Member experience"). Pure.
 *
 * Order is the page order: lessons that sit outside any module first, then the modules by
 * position, each showing its own lessons before its nested modules (the weeks inside a month).
 * "Previous" and "next" walk the open lessons in that order; "Coming soon" lessons show in the
 * outline but can't be opened, so navigation skips them.
 */

export interface OutlineModule {
  id: string;
  parent_id: string | null;
  title: string;
  position: number;
  state: "open" | "coming_soon";
}

export interface OutlineLesson {
  id: string;
  module_id: string | null;
  title: string;
  position: number;
  state: "open" | "coming_soon";
  duration_seconds: number | null;
}

export interface OutlineNode {
  module: OutlineModule;
  lessons: OutlineLesson[];
  children: OutlineNode[];
}

export interface Outline {
  /** Lessons that belong to no module. */
  loose: OutlineLesson[];
  modules: OutlineNode[];
  /** Every lesson in page order. */
  lessons: OutlineLesson[];
}

const byPosition = <T extends { position: number; title: string }>(a: T, b: T) =>
  a.position - b.position || a.title.localeCompare(b.title);

export function buildOutline(modules: OutlineModule[], lessons: OutlineLesson[]): Outline {
  const moduleIds = new Set(modules.map((m) => m.id));
  const nodes = new Map<string, OutlineNode>(modules.map((m) => [m.id, { module: m, lessons: [], children: [] }]));

  const loose: OutlineLesson[] = [];
  for (const lesson of [...lessons].sort(byPosition)) {
    const node = lesson.module_id ? nodes.get(lesson.module_id) : undefined;
    if (node) node.lessons.push(lesson);
    else loose.push(lesson);
  }

  const roots: OutlineNode[] = [];
  for (const m of [...modules].sort((a, b) => byPosition(a, b))) {
    const node = nodes.get(m.id)!;
    const parent = m.parent_id && moduleIds.has(m.parent_id) ? nodes.get(m.parent_id) : undefined;
    (parent ? parent.children : roots).push(node);
  }

  const flat: OutlineLesson[] = [...loose];
  const walk = (node: OutlineNode) => {
    flat.push(...node.lessons);
    node.children.forEach(walk);
  };
  roots.forEach(walk);

  return { loose, modules: roots, lessons: flat };
}

export interface LessonNeighbors {
  previous: OutlineLesson | null;
  next: OutlineLesson | null;
}

/**
 * The open lessons before and after `lessonId`, in page order. Staff previewing the course pass
 * `includeComingSoon` to step through unreleased lessons too.
 */
export function lessonNeighbors(outline: Outline, lessonId: string, options: { includeComingSoon?: boolean } = {}): LessonNeighbors {
  const open = outline.lessons.filter((l) => options.includeComingSoon || l.state === "open");
  const i = open.findIndex((l) => l.id === lessonId);
  if (i === -1) return { previous: null, next: null };
  return { previous: open[i - 1] ?? null, next: open[i + 1] ?? null };
}

export interface CourseProgress {
  /** Open lessons, the ones that count: the course grows as lessons are released. */
  available: number;
  completed: number;
  /** Where "Start" or "Continue" goes: the first open lesson not yet completed, else the first open one. */
  continueLessonId: string | null;
  /** True once every available lesson is done and there's something to have done. */
  allDone: boolean;
}

export function courseProgress(outline: Outline, completedLessonIds: Set<string>): CourseProgress {
  const open = outline.lessons.filter((l) => l.state === "open");
  const completed = open.filter((l) => completedLessonIds.has(l.id)).length;
  const next = open.find((l) => !completedLessonIds.has(l.id)) ?? open[0] ?? null;
  return {
    available: open.length,
    completed,
    continueLessonId: next?.id ?? null,
    allDone: open.length > 0 && completed === open.length,
  };
}

/** "9:05" or "1:02:03" for a lesson length. */
export function formatDuration(seconds: number | null): string | null {
  if (seconds === null || !Number.isFinite(seconds) || seconds <= 0) return null;
  const total = Math.round(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;
}
