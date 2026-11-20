import { getMemberDisplayName } from "@/lib/member-display-name";
import type { Repos } from "@/lib/data/repos";

/** What a template's or version's "by" shows when the admin has no member record. */
export const UNKNOWN_EDITOR = "An admin";

/**
 * The display names of the admins behind some auth user ids (the `created_by` and `updated_by` of templates and versions),
 * by user id. A handful of ids, looked up together; one with no member record reads "An admin".
 */
export async function editorNames(repos: Pick<Repos, "members">, userIds: (string | null)[]): Promise<Map<string, string>> {
  const ids = [...new Set(userIds.filter((id): id is string => Boolean(id)))];
  const members = await Promise.all(ids.map((id) => repos.members.byUserId(id)));
  return new Map(ids.map((id, i) => [id, members[i] ? getMemberDisplayName(members[i]) : UNKNOWN_EDITOR]));
}
