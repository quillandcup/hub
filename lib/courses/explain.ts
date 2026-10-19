import { planVisibleTree, visibilityFromPublishing, type Visibility } from "@/lib/courses/visibility";

/**
 * Why each module and lesson of a Kajabi course is open, "Coming soon" or hidden in the Hub, for
 * the admin Courses page (so whoever edits the course in Kajabi can see what to change). Pure.
 *
 * The state is exactly what members get: it comes from `planVisibleTree`, the same rule the
 * Silver processing uses, so the explanation can't drift from the result. The reason says which
 * Kajabi setting decides it: the item's own, or the nearest module above it that limits it.
 */

export interface ExplainModuleIn {
  kajabiId: string;
  parentKajabiId: string | null;
  position: number | null;
  title: string;
  publishingOption: string | null;
}

export interface ExplainLessonIn {
  kajabiId: string;
  moduleKajabiId: string | null;
  position: number | null;
  title: string;
  publishingOption: string | null;
}

export interface ExplainedLesson {
  kajabiId: string;
  title: string;
  publishingOption: string | null;
  state: Visibility;
  reason: string;
}

export interface ExplainedModule {
  kajabiId: string;
  title: string;
  publishingOption: string | null;
  state: Visibility;
  reason: string;
  lessons: ExplainedLesson[];
  children: ExplainedModule[];
}

export interface ExplainedCourse {
  /** Lessons that sit in no module. */
  loose: ExplainedLesson[];
  modules: ExplainedModule[];
  totals: Record<Visibility, number>;
}

const OPTION_LABEL: Record<string, string> = { published: "Published", locked: "Locked", drip: "Drip", draft: "Draft" };
const label = (option: string | null) => (option ? OPTION_LABEL[option] ?? option : "no setting");

const byPosition = <T extends { position: number | null; title: string }>(a: T, b: T) =>
  (a.position ?? 0) - (b.position ?? 0) || a.title.localeCompare(b.title);

export function explainCourse(modules: ExplainModuleIn[], lessons: ExplainLessonIn[]): ExplainedCourse {
  const byId = new Map(modules.map((m) => [m.kajabiId, m]));
  const tree = planVisibleTree(
    modules.map((m) => ({ kajabiId: m.kajabiId, parentKajabiId: m.parentKajabiId, publishingOption: m.publishingOption })),
    lessons.map((l) => ({ kajabiId: l.kajabiId, moduleKajabiId: l.moduleKajabiId, publishingOption: l.publishingOption }))
  );

  const reasonFor = (state: Visibility, own: string | null, parentId: string | null): string => {
    const ownVisibility = visibilityFromPublishing(own);
    if (state === "open") return "Published";
    if (state === ownVisibility) return `${label(own)} in Kajabi`;
    // Limited by a module above: the nearest one whose own setting gives this state.
    const seen = new Set<string>();
    for (let id = parentId; id && !seen.has(id); ) {
      seen.add(id);
      const m = byId.get(id);
      if (!m) return "Its module is missing from Kajabi's response";
      if (visibilityFromPublishing(m.publishingOption) === state) return `Inside “${m.title}” (${label(m.publishingOption)})`;
      id = m.parentKajabiId;
    }
    return "Its module can't be resolved";
  };

  const explainLesson = (l: ExplainLessonIn): ExplainedLesson => {
    const state: Visibility = tree.lessons.get(l.kajabiId) ?? "hidden";
    const parent = l.moduleKajabiId && byId.has(l.moduleKajabiId) ? l.moduleKajabiId : null;
    return { kajabiId: l.kajabiId, title: l.title, publishingOption: l.publishingOption, state, reason: reasonFor(state, l.publishingOption, parent) };
  };

  const lessonsByModule = new Map<string, ExplainLessonIn[]>();
  const loose: ExplainLessonIn[] = [];
  for (const l of lessons) {
    if (l.moduleKajabiId && byId.has(l.moduleKajabiId)) {
      lessonsByModule.set(l.moduleKajabiId, [...(lessonsByModule.get(l.moduleKajabiId) ?? []), l]);
    } else loose.push(l);
  }

  const explainModule = (m: ExplainModuleIn): ExplainedModule => {
    const state: Visibility = tree.modules.get(m.kajabiId) ?? "hidden";
    const parent = m.parentKajabiId && byId.has(m.parentKajabiId) ? m.parentKajabiId : null;
    return {
      kajabiId: m.kajabiId,
      title: m.title,
      publishingOption: m.publishingOption,
      state,
      reason: m.parentKajabiId && !parent ? "Its parent module is missing from Kajabi's response" : reasonFor(state, m.publishingOption, parent),
      lessons: (lessonsByModule.get(m.kajabiId) ?? []).sort(byPosition).map(explainLesson),
      children: modules
        .filter((c) => c.parentKajabiId === m.kajabiId)
        .sort(byPosition)
        .map(explainModule),
    };
  };

  const roots = modules.filter((m) => !m.parentKajabiId || !byId.has(m.parentKajabiId)).sort(byPosition).map(explainModule);

  const totals: Record<Visibility, number> = { open: 0, coming_soon: 0, hidden: 0 };
  for (const l of lessons) totals[tree.lessons.get(l.kajabiId) ?? "hidden"]++;

  return { loose: loose.sort(byPosition).map(explainLesson), modules: roots, totals };
}
