import { getMemberDisplayName } from "@/lib/member-display-name";
import type { Repos } from "@/lib/data/repos";

/** The roles that may own an engagement: admins and the community manager (staff who work Hedgie Care). */
export const CARE_OWNER_ROLES = ["admin", "community_manager"] as const;

/** A staff user who may own engagements: the auth user id (a uuid, not one of our table ids), the name shown, the role. */
export type CareOwner = { id: string; name: string; role: string };

const FALLBACK_NAME = "A staff member";

/**
 * Everyone who may own an engagement, with the name the community knows them by (their member record's display name, else
 * the legal name; never an email). `privileged` reads `user_profiles`, which a community manager's own client may not
 * read for other users, so the caller passes service-role repositories after checking who is asking; only the id, name and
 * role leave this function. Names come from `members` through the caller's own client.
 */
export async function loadCareOwners(repos: Pick<Repos, "members">, privileged: Pick<Repos, "profiles">): Promise<CareOwner[]> {
  const staff = await privileged.profiles.byRoles([...CARE_OWNER_ROLES]);
  const members = await Promise.all(staff.map((s) => repos.members.byUserId(s.id)));
  return staff
    .map((s, i) => ({ id: s.id, role: s.role, name: members[i] ? getMemberDisplayName({ name: members[i]!.name, display_name: members[i]!.displayName }) : FALLBACK_NAME }))
    .sort((a, b) => a.name.localeCompare(b.name) || (a.id < b.id ? -1 : 1));
}

/** Whether this auth user may own an engagement. Reads the profile's role, never a token claim. */
export async function isCareOwner(privileged: Pick<Repos, "profiles">, userId: string): Promise<boolean> {
  const profile = await privileged.profiles.byId(userId);
  return !!profile && (CARE_OWNER_ROLES as readonly string[]).includes(profile.role);
}

/** The name to show for an owner: from the list, "Unassigned" for none, a neutral label for someone no longer staff. */
export function ownerName(ownerId: string | null, owners: readonly CareOwner[]): string {
  if (!ownerId) return "Unassigned";
  return owners.find((o) => o.id === ownerId)?.name ?? FALLBACK_NAME;
}
