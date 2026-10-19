/**
 * What members see of a Kajabi course (docs/COURSES.md, "Lesson state"). Pure.
 *
 * Kajabi's publishing option decides: `published` is open, `locked`/`drip` is "Coming soon" (the
 * title shows, it can't be opened; this is how the whole plan appears from day one), and
 * `draft` (or anything unrecognised) is hidden: drafts are work in progress and must not leak.
 * A module's state limits what's inside it, and a nested module is limited by its parent, so a
 * lesson is never more visible than the module it sits in.
 */

export type Visibility = "open" | "coming_soon" | "hidden";

const RANK: Record<Visibility, number> = { hidden: 0, coming_soon: 1, open: 2 };

export function visibilityFromPublishing(option: string | null | undefined): Visibility {
  switch (option) {
    case "published":
      return "open";
    case "locked":
    case "drip":
      return "coming_soon";
    default:
      return "hidden";
  }
}

function lessVisible(a: Visibility, b: Visibility): Visibility {
  return RANK[a] <= RANK[b] ? a : b;
}

interface ModuleIn {
  kajabiId: string;
  parentKajabiId: string | null;
  publishingOption: string | null;
}

interface LessonIn {
  kajabiId: string;
  moduleKajabiId: string | null;
  publishingOption: string | null;
}

export interface VisibleTree {
  /** Visible modules only, by Kajabi id. */
  modules: Map<string, "open" | "coming_soon">;
  /** Visible lessons only, by Kajabi id. */
  lessons: Map<string, "open" | "coming_soon">;
}

export function planVisibleTree(modules: ModuleIn[], lessons: LessonIn[]): VisibleTree {
  const byId = new Map(modules.map((m) => [m.kajabiId, m]));
  const effective = new Map<string, Visibility>();

  const moduleVisibility = (id: string, seen = new Set<string>()): Visibility => {
    const cached = effective.get(id);
    if (cached) return cached;
    const m = byId.get(id);
    if (!m || seen.has(id)) return "hidden"; // unknown parent or a cycle: never show
    seen.add(id);
    let v = visibilityFromPublishing(m.publishingOption);
    if (m.parentKajabiId) v = lessVisible(v, moduleVisibility(m.parentKajabiId, seen));
    effective.set(id, v);
    return v;
  };

  const visibleModules = new Map<string, "open" | "coming_soon">();
  for (const m of modules) {
    const v = moduleVisibility(m.kajabiId);
    if (v !== "hidden") visibleModules.set(m.kajabiId, v);
  }

  const visibleLessons = new Map<string, "open" | "coming_soon">();
  for (const l of lessons) {
    let v = visibilityFromPublishing(l.publishingOption);
    if (l.moduleKajabiId && byId.has(l.moduleKajabiId)) v = lessVisible(v, moduleVisibility(l.moduleKajabiId));
    if (v !== "hidden") visibleLessons.set(l.kajabiId, v);
  }

  return { modules: visibleModules, lessons: visibleLessons };
}

/** URL slug for a course, from its Kajabi title: "The Ready Writer" -> "the-ready-writer". */
export function slugifyTitle(title: string): string {
  return title
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
