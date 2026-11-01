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

/** Every module's and lesson's state, drafts included (`hidden`), by Kajabi id. */
export interface FullTree {
  modules: Map<string, Visibility>;
  lessons: Map<string, Visibility>;
}

/**
 * What an item's state is, given its own setting and the state of what is above it: its setting gives
 * its visibility, never more than what is above it; `inherit` (a Hub-owned item that simply follows) is
 * what is above it. The same rule as `course_item_state` in the database (migration 20270330000000).
 */
export function itemState(option: string | null | undefined, above: Visibility): Visibility {
  return option === "inherit" ? above : lessVisible(visibilityFromPublishing(option), above);
}

/**
 * The effective state of every module and lesson, by the one rule: its own publishing option,
 * limited by every module above it and by the course (`courseOption`, published for an imported
 * course). Hidden ones are in the result, marked `hidden`: they are stored so staff can preview them,
 * and never shown to members.
 */
export function planFullTree(modules: ModuleIn[], lessons: LessonIn[], courseOption: string = "published"): FullTree {
  const byId = new Map(modules.map((m) => [m.kajabiId, m]));
  const effective = new Map<string, Visibility>();
  const courseState = visibilityFromPublishing(courseOption);

  const moduleVisibility = (id: string, seen = new Set<string>()): Visibility => {
    const cached = effective.get(id);
    if (cached) return cached;
    const m = byId.get(id);
    if (!m || seen.has(id)) return "hidden"; // unknown parent or a cycle: never show
    seen.add(id);
    const v = itemState(m.publishingOption, m.parentKajabiId ? moduleVisibility(m.parentKajabiId, seen) : courseState);
    effective.set(id, v);
    return v;
  };

  const moduleStates = new Map<string, Visibility>();
  for (const m of modules) moduleStates.set(m.kajabiId, moduleVisibility(m.kajabiId));

  const lessonStates = new Map<string, Visibility>();
  for (const l of lessons) {
    lessonStates.set(l.kajabiId, itemState(l.publishingOption, l.moduleKajabiId && byId.has(l.moduleKajabiId) ? moduleVisibility(l.moduleKajabiId) : courseState));
  }

  return { modules: moduleStates, lessons: lessonStates };
}

/** What members see: `planFullTree` without the hidden ones. */
export function planVisibleTree(modules: ModuleIn[], lessons: LessonIn[], courseOption: string = "published"): VisibleTree {
  const full = planFullTree(modules, lessons, courseOption);
  const visible = <T extends Map<string, Visibility>>(states: T) =>
    new Map([...states].filter((entry): entry is [string, "open" | "coming_soon"] => entry[1] !== "hidden"));
  return { modules: visible(full.modules), lessons: visible(full.lessons) };
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
