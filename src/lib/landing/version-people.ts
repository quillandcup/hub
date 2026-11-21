import { getMemberDisplayName } from "@/lib/member-display-name";
import type { Repos } from "@/lib/data/repos";
import { UNKNOWN_EDITOR } from "@/lib/landing/version-notes";

/**
 * The display names of the admins behind some auth user ids (a version's `published_by`), by user id, so History can say who made a
 * version without a user id ever reaching the browser. A handful of ids, looked up together; one with no member record reads "Someone".
 */
export async function editorNames(repos: Pick<Repos, "members">, userIds: (string | null)[]): Promise<Map<string, string>> {
  const ids = [...new Set(userIds.filter((id): id is string => Boolean(id)))];
  const members = await Promise.all(ids.map((id) => repos.members.byUserId(id)));
  return new Map(ids.map((id, i) => [id, members[i] ? getMemberDisplayName(members[i]) : UNKNOWN_EDITOR]));
}
