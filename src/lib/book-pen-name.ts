import { createRepos } from "@/lib/data/repos";
import type { Db } from "@/lib/data/db";
import { getMemberDisplayName } from "@/lib/member-display-name";

export interface PenNameOptions {
  /** What a book with no pen name is shown under: the display name, else the legal name. */
  defaultName: string;
  /** The member's own active name aliases, other than the default. */
  others: string[];
}

/** The names a member can publish a book under: their display name plus their own active aliases. */
export async function getPenNameOptions(db: Db, memberId: string): Promise<PenNameOptions | null> {
  const repos = createRepos(db);
  const [member, aliases] = await Promise.all([repos.members.byId(memberId), repos.aliases.namesOf(memberId)]);
  if (!member) return null;
  const defaultName = getMemberDisplayName({ name: member.name, display_name: member.displayName });
  const others = aliases.filter((a) => a.active && a.alias !== defaultName).map((a) => a.alias);
  return { defaultName, others };
}

/**
 * Checks a pen name from a form against the member's own options. Blank or the default name is
 * stored as null (follow the display name); anything else must be one of their active aliases, so
 * a book can't be published under a name that isn't theirs.
 */
export async function resolvePenName(
  db: Db,
  memberId: string,
  penName: string | null | undefined,
): Promise<{ penName: string | null } | { error: string }> {
  const wanted = penName?.trim();
  if (!wanted) return { penName: null };
  const options = await getPenNameOptions(db, memberId);
  if (!options) return { error: "No member record" };
  if (wanted === options.defaultName) return { penName: null };
  if (!options.others.includes(wanted)) return { error: "Pick one of your own names" };
  return { penName: wanted };
}
