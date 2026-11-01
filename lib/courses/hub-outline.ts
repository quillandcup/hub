import { explainCourse, type ExplainedLesson, type ExplainedModule } from "@/lib/courses/explain";

/**
 * The outline of a Hub-owned course, built from its own rows (not from Kajabi's import) in the shape
 * the builder's outline draws, plus the small pure helpers the editor uses to reorder it. Pure.
 *
 * The states and the reasons come from `explainCourse`, the same code that explains an imported
 * course, fed the same kind of settings (each item's own, which may be to follow what is above it, and
 * the course's), so the two outlines read alike and differ only in who owns them.
 */

export interface HubModuleRow {
  id: string;
  parent_id: string | null;
  title: string;
  position: number;
  /** The module's own setting: inherit, draft, published, locked ... */
  publishing_option: string | null;
}

export interface HubLessonRow {
  id: string;
  module_id: string | null;
  title: string;
  position: number;
  publishing_option: string | null;
  /** Whether the lesson has text and a video yet, for the "text ✓ · video –" line. */
  hasText: boolean;
  hasVideo: boolean;
}

export interface HubOutline {
  loose: ExplainedLesson[];
  modules: ExplainedModule[];
  content: Record<string, { hasText: boolean; hasVideo: boolean }>;
}

export function buildHubOutline(modules: HubModuleRow[], lessons: HubLessonRow[]): HubOutline {
  // The id goes in `kajabiId`: the outline's rows are keyed and linked by it, and a Hub-owned item has no Kajabi id.
  const explained = explainCourse(
    modules.map((m) => ({ kajabiId: m.id, parentKajabiId: m.parent_id, position: m.position, title: m.title, publishingOption: m.publishing_option })),
    lessons.map((l) => ({ kajabiId: l.id, moduleKajabiId: l.module_id, position: l.position, title: l.title, publishingOption: l.publishing_option })),
    { place: "the Hub" }
  );
  return {
    loose: explained.loose,
    modules: explained.modules,
    content: Object.fromEntries(lessons.map((l) => [l.id, { hasText: l.hasText, hasVideo: l.hasVideo }])),
  };
}

/** `ids` with `id` moved to where `before` is (dropped onto it). Unchanged for an id that isn't there or is dropped on itself. */
export function moveBefore(ids: string[], id: string, before: string): string[] {
  if (id === before || !ids.includes(id) || !ids.includes(before)) return ids;
  const without = ids.filter((x) => x !== id);
  without.splice(without.indexOf(before), 0, id);
  return without;
}

/** `ids` with `id` moved one place up (delta -1) or down (+1); unchanged at either end. */
export function moveBy(ids: string[], id: string, delta: -1 | 1): string[] {
  const from = ids.indexOf(id);
  const to = from + delta;
  if (from === -1 || to < 0 || to >= ids.length) return ids;
  const next = [...ids];
  [next[from], next[to]] = [next[to], next[from]];
  return next;
}

/** How many lessons and submodules a module holds, for "its 3 lessons go with it". */
export function moduleContents(parent: ExplainedModule): { lessons: number; submodules: number } {
  let lessons = parent.lessons.length;
  for (const child of parent.children) lessons += moduleContents(child).lessons;
  return { lessons, submodules: parent.children.length };
}
