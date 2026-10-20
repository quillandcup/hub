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
  /** Lesson thumbnail from Kajabi (https), when the content step recorded one. */
  thumbnail_url?: string | null;
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

/**
 * The module a lesson sits directly in, with just its own lessons (not nested modules), as a
 * one-module outline: what the lesson page lists next to the video ("this week's lessons").
 * Null for a lesson outside any module.
 */
export function lessonSection(outline: Outline, lessonId: string): Outline | null {
  let found: OutlineNode | null = null;
  const find = (nodes: OutlineNode[]) => {
    for (const node of nodes) {
      if (node.lessons.some((l) => l.id === lessonId)) found = node;
      else find(node.children);
      if (found) return;
    }
  };
  find(outline.modules);
  if (!found) return null;
  const node: OutlineNode = found;
  return { loose: [], modules: [{ ...node, children: [] }], lessons: node.lessons };
}

/**
 * The first lesson of the next section (module or week): the first lesson after the current
 * lesson's own module, in page order, that sits in a different module. Members only get open
 * lessons; staff previewing pass `includeComingSoon`. Null when there is no next module (the last
 * section, a lesson outside any module, or nothing open after it).
 */
export function nextModuleLesson(outline: Outline, lessonId: string, options: { includeComingSoon?: boolean } = {}): OutlineLesson | null {
  const current = outline.lessons.find((l) => l.id === lessonId);
  if (!current || !current.module_id) return null;
  const moduleId = current.module_id;
  const lastOfSection = outline.lessons.map((l) => l.module_id).lastIndexOf(moduleId);
  return (
    outline.lessons
      .slice(lastOfSection + 1)
      .find((l) => l.module_id !== moduleId && l.module_id !== null && (options.includeComingSoon || l.state === "open")) ?? null
  );
}

export interface LessonContext {
  /** Titles of the modules the lesson sits in, outermost first ("Module 2", "Week 1"). */
  trail: string[];
  /** 1-based place among the lessons members can open, and how many there are. */
  position: number;
  total: number;
}

/**
 * Where a lesson sits, for its page header (the lesson page has no outline of its own). The count
 * is of open lessons, the ones that count as available; a "Coming soon" lesson (a staff preview) is
 * counted among all lessons instead, since it isn't one of the open ones.
 */
export function lessonContext(outline: Outline, lessonId: string): LessonContext | null {
  const current = outline.lessons.find((l) => l.id === lessonId);
  if (!current) return null;

  let trail: string[] = [];
  const find = (nodes: OutlineNode[], path: string[]): boolean => {
    for (const node of nodes) {
      const here = [...path, node.module.title];
      if (node.lessons.some((l) => l.id === lessonId)) {
        trail = here;
        return true;
      }
      if (find(node.children, here)) return true;
    }
    return false;
  };
  find(outline.modules, []);

  const pool = current.state === "open" ? outline.lessons.filter((l) => l.state === "open") : outline.lessons;
  return { trail, position: pool.findIndex((l) => l.id === lessonId) + 1, total: pool.length };
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
