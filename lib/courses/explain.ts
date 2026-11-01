import { planFullTree, visibilityFromPublishing, type Visibility } from "@/lib/courses/visibility";

/**
 * Why each module and lesson of a Kajabi course is open, "Coming soon" or hidden in the Hub, for
 * the admin Courses page (so whoever edits the course in Kajabi can see what to change). Pure.
 *
 * The state is exactly what members get: it comes from `planFullTree`, the same rule the
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

const OPTION_LABEL: Record<string, string> = { published: "Published", locked: "Locked", drip: "Drip", draft: "Draft", scheduled: "Scheduled", inherit: "Follows what is above" };
const label = (option: string | null) => (option ? OPTION_LABEL[option] ?? option : "no setting");

const byPosition = <T extends { position: number | null; title: string }>(a: T, b: T) =>
  (a.position ?? 0) - (b.position ?? 0) || a.title.localeCompare(b.title);

export interface ExplainOptions {
  /** Where the settings are kept, for the wording of a reason: Kajabi's, or the Hub's own. */
  place?: "Kajabi" | "the Hub";
}

export function explainCourse(modules: ExplainModuleIn[], lessons: ExplainLessonIn[], options: ExplainOptions = {}): ExplainedCourse {
  const place = options.place ?? "Kajabi";
  const byId = new Map(modules.map((m) => [m.kajabiId, m]));
  const moduleIns = modules.map((m) => ({ kajabiId: m.kajabiId, parentKajabiId: m.parentKajabiId, publishingOption: m.publishingOption }));
  const lessonIns = lessons.map((l) => ({ kajabiId: l.kajabiId, moduleKajabiId: l.moduleKajabiId, publishingOption: l.publishingOption }));
  // Hidden ones are in it, so a reason can say which module above hides an item.
  const tree = planFullTree(moduleIns, lessonIns);

  const reasonFor = (state: Visibility, own: string | null, parentId: string | null): string => {
    const above = parentId ? byId.get(parentId) : null;
    if (own === "inherit") {
      const follows = above ? `“${above.title}”` : "the course";
      return state === "open" ? `Follows ${follows}` : state === "coming_soon" ? `Follows ${follows}: coming soon` : `Follows ${follows}: not published yet`;
    }
    const ownVisibility = visibilityFromPublishing(own);
    if (state === "open") return "Published";
    if (state === ownVisibility) return `${label(own)} in ${place}`;
    // Limited by what is above: the nearest module with a setting of its own that gives this state.
    const seen = new Set<string>();
    for (let id = parentId; id && !seen.has(id); ) {
      seen.add(id);
      const m = byId.get(id);
      if (!m) return place === "Kajabi" ? "Its module is missing from Kajabi's response" : "Its module can't be found";
      if (m.publishingOption !== "inherit" && tree.modules.get(id) === state && visibilityFromPublishing(m.publishingOption) === state) return `Inside “${m.title}” (${label(m.publishingOption)})`;
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
      reason: m.parentKajabiId && !parent ? (place === "Kajabi" ? "Its parent module is missing from Kajabi's response" : "Its parent module can't be found") : reasonFor(state, m.publishingOption, parent),
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

/**
 * What members get from an item, for a card that already shows its own Kajabi status: the effect,
 * and the module above it when that is what decides ("Inside “Module 2” (Locked)"). The item's own
 * setting isn't repeated ("Draft in Kajabi", "Published").
 */
export function memberEffect(state: Visibility, reason: string): string {
  const effect = state === "open" ? "Members can open it." : state === "coming_soon" ? "Members see it as coming soon." : "Members don't see it.";
  const decidedByItself = reason === "Published" || / in (Kajabi|the Hub)$/.test(reason);
  return decidedByItself ? effect : `${effect} ${reason}.`;
}
