import type { ExplainedLesson, ExplainedModule } from "@/lib/courses/explain";

/**
 * The outline of a Hub-owned course, built from its own rows (not from Kajabi's import) in the shape
 * the builder's outline draws, plus the small pure helpers the editor uses to reorder it. Pure.
 */

export interface HubModuleRow {
  id: string;
  parent_id: string | null;
  title: string;
  position: number;
  /** open, coming_soon or hidden: the state members get. */
  state: string;
}

export interface HubLessonRow {
  id: string;
  module_id: string | null;
  title: string;
  position: number;
  state: string;
  /** Whether the lesson has text and a video yet, for the "text ✓ · video –" line. */
  hasText: boolean;
  hasVideo: boolean;
}

export interface HubOutline {
  loose: ExplainedLesson[];
  modules: ExplainedModule[];
  content: Record<string, { hasText: boolean; hasVideo: boolean }>;
}

// Until a Hub-owned item has a setting of its own (the status menu comes next), its pill shows the
// state members get, in Kajabi's words.
const OPTION_FOR_STATE: Record<string, string> = { open: "published", coming_soon: "locked", hidden: "draft" };
const REASON_FOR_STATE: Record<string, string> = { open: "Published", coming_soon: "Coming soon", hidden: "Draft: not published yet" };

const byPosition = <T extends { position: number; title: string; id: string }>(a: T, b: T) => a.position - b.position || a.title.localeCompare(b.title) || a.id.localeCompare(b.id);

const visibility = (state: string): "open" | "coming_soon" | "hidden" => (state === "open" || state === "coming_soon" ? state : "hidden");

function lesson(row: HubLessonRow): ExplainedLesson {
  const state = visibility(row.state);
  // The id goes in `kajabiId`: the outline's rows are keyed and linked by it, and a Hub-owned item has no Kajabi id.
  return { kajabiId: row.id, title: row.title, publishingOption: OPTION_FOR_STATE[state], state, reason: REASON_FOR_STATE[state] };
}

export function buildHubOutline(modules: HubModuleRow[], lessons: HubLessonRow[]): HubOutline {
  const byId = new Map(modules.map((m) => [m.id, m]));
  const lessonsIn = new Map<string | null, HubLessonRow[]>();
  for (const l of lessons) {
    // A lesson whose module isn't in the list (it can't happen through the foreign key) is shown loose, not dropped.
    const key = l.module_id && byId.has(l.module_id) ? l.module_id : null;
    lessonsIn.set(key, [...(lessonsIn.get(key) ?? []), l]);
  }

  const toModule = (row: HubModuleRow, seen: Set<string>): ExplainedModule => {
    const state = visibility(row.state);
    seen.add(row.id);
    return {
      kajabiId: row.id,
      title: row.title,
      publishingOption: OPTION_FOR_STATE[state],
      state,
      reason: REASON_FOR_STATE[state],
      lessons: (lessonsIn.get(row.id) ?? []).sort(byPosition).map(lesson),
      children: modules
        .filter((c) => c.parent_id === row.id && !seen.has(c.id))
        .sort(byPosition)
        .map((c) => toModule(c, seen)),
    };
  };

  const seen = new Set<string>();
  const roots = modules.filter((m) => !m.parent_id || !byId.has(m.parent_id)).sort(byPosition);
  return {
    loose: (lessonsIn.get(null) ?? []).sort(byPosition).map(lesson),
    modules: roots.map((r) => toModule(r, seen)),
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
