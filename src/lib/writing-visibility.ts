/**
 * Who can see a writing project or goal: only the writer, signed-in members, or the whole internet.
 * One click on `VisibilityControl` cycles private -> community -> public -> private.
 *
 * `show_on_profile` is the older on/off flag; the database keeps it equal to `visibility <> 'private'` until it is
 * dropped (docs/TODO.md, "Drop show_on_profile"), and `reconcileVisibility` does the same for the in-memory twin.
 */
export const VISIBILITIES = ["private", "community", "public"] as const;
export type Visibility = (typeof VISIBILITIES)[number];

export function isVisibility(value: unknown): value is Visibility {
  return typeof value === "string" && (VISIBILITIES as readonly string[]).includes(value);
}

/** private < community < public. */
export function visibilityRank(visibility: Visibility): number {
  return VISIBILITIES.indexOf(visibility);
}

/**
 * The level one click moves to: private, community, public, then back to private. With `levels` (a profile item that has no
 * globe), the cycle is only those, in the same order; a level outside them moves to the first.
 */
export function nextVisibility(visibility: Visibility, levels: readonly Visibility[] = VISIBILITIES): Visibility {
  const at = levels.indexOf(visibility);
  return levels[(at + 1) % levels.length];
}

/** Whether other members can see it (the old "on my profile" flag). */
export function isShownToMembers(visibility: Visibility): boolean {
  return visibility !== "private";
}

/** The more private of two levels: a goal is never more visible than its project. */
export function lessVisible(a: Visibility, b: Visibility): Visibility {
  return visibilityRank(a) <= visibilityRank(b) ? a : b;
}

interface VisibilityState {
  visibility: Visibility;
  show_on_profile: boolean;
}

/**
 * What the two columns become after a write, mirroring the database triggers
 * (`20270831000000_writing_three_level_visibility.sql`): naming `visibility` wins; naming only `show_on_profile` moves
 * private <-> community; a new row that names only one of them follows it (`defaults` are the column defaults).
 */
export function reconcileVisibility(
  before: VisibilityState | null,
  write: { visibility?: Visibility; show_on_profile?: boolean },
  defaults: VisibilityState
): VisibilityState {
  if (before === null) {
    const visibility = write.visibility ?? defaults.visibility;
    const shown = write.show_on_profile ?? defaults.show_on_profile;
    if (write.visibility !== undefined) return { visibility, show_on_profile: isShownToMembers(visibility) };
    if (shown === defaults.show_on_profile) return { visibility, show_on_profile: shown };
    return { visibility: shown ? "community" : "private", show_on_profile: shown };
  }
  if (write.visibility !== undefined && write.visibility !== before.visibility) {
    return { visibility: write.visibility, show_on_profile: isShownToMembers(write.visibility) };
  }
  if (write.show_on_profile !== undefined && write.show_on_profile !== before.show_on_profile) {
    const visibility: Visibility = !write.show_on_profile ? "private" : before.visibility === "private" ? "community" : before.visibility;
    return { visibility, show_on_profile: write.show_on_profile };
  }
  return before;
}

/** A row's level, reading an older row that has only the on/off flag (a fixture or twin row without `visibility`) as community or private. */
export function visibilityOf(row: { visibility?: Visibility; show_on_profile: boolean }): Visibility {
  return row.visibility ?? (row.show_on_profile ? "community" : "private");
}
