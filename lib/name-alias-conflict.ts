import { createServiceRoleClient } from "@/lib/supabase/service";
import { SUPPORT_EMAIL } from "@/lib/config";

/**
 * Whether a name can be added as an alias (a Zoom/Slack/pen name that attendance is matched by) for
 * a member, checked against everyone's names with `public.name_alias_conflict`. The matcher tries
 * aliases before full names, so an alias equal to another member's alias or real name would take
 * that member's attendance. Every path that creates a name alias asks this first: the member's own
 * Settings → Identity, and the admin routes.
 *
 * Runs as the service role (members can't read each other's names; the function is closed to
 * everyone else), so call it only after the caller's identity or admin role is verified.
 */
export type NameAliasConflictKind = "own" | "own_inactive" | "other_alias" | "other_name";

export interface NameAliasConflict {
  kind: NameAliasConflictKind;
  /** Whose it is, for other_alias / other_name; null for the member's own. */
  otherMemberId: string | null;
  otherMemberName: string | null;
}

const KINDS: readonly string[] = ["own", "own_inactive", "other_alias", "other_name"];

export async function findNameAliasConflict(
  memberId: string,
  alias: string
): Promise<{ conflict: NameAliasConflict | null } | { error: string }> {
  const { data, error } = await createServiceRoleClient().rpc("name_alias_conflict", {
    p_member_id: memberId,
    p_alias: alias,
  });
  if (error) return { error: error.message };
  const row = (data as { kind: string; other_member_id: string | null; other_member_name: string | null }[] | null)?.[0];
  if (!row) return { conflict: null };
  return {
    conflict: {
      // A kind this code doesn't know is treated as the most cautious: someone else's.
      kind: (KINDS.includes(row.kind) ? row.kind : "other_alias") as NameAliasConflictKind,
      otherMemberId: row.other_member_id,
      otherMemberName: row.other_member_name,
    },
  };
}

/** For the member adding their own name: never says whose it is. */
export const MEMBER_NAME_ALIAS_CONFLICT_MESSAGES: Record<NameAliasConflictKind, string> = {
  own: "That name is already on your list.",
  own_inactive: `That name is already on your list, but it was deactivated. Contact support at ${SUPPORT_EMAIL} to use it.`,
  other_alias: `Another member already uses that name in Zoom or Slack, so it can't be added here. If it's really yours, email ${SUPPORT_EMAIL}.`,
  other_name: `That's another member's name, so it can't be added as yours. If it's really what Zoom shows for you, email ${SUPPORT_EMAIL}.`,
};

/** For an admin: says whose it is. To move an alias between members, use the move-aliases tool. */
export function adminNameAliasConflictMessage(alias: string, conflict: NameAliasConflict): string {
  const holder = conflict.otherMemberName ?? "another member";
  switch (conflict.kind) {
    case "own":
      return `"${alias}" is already one of this member's names.`;
    case "own_inactive":
      return `"${alias}" is already one of this member's names, switched off.`;
    case "other_name":
      return `"${alias}" is ${holder}'s real name, so it can't also be an alias for someone else.`;
    default:
      return `"${alias}" is already an alias for ${holder}. Move it from there first.`;
  }
}
