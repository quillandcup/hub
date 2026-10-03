import { matchSlackUsersToMembers } from "@/lib/slack-matching";

/**
 * Member <-> Slack user resolution for server code that DMs members (notifications) or handles
 * their Slack interactions. Reads other members' emails/aliases and bronze.slack_users, so pass a
 * service-role client.
 */

const BATCH_SIZE = 1000;

async function fetchAllPaginated<T>(
  queryFn: (offset: number) => PromiseLike<{ data: T[] | null }>
): Promise<T[]> {
  let all: T[] = [];
  let offset = 0;
  let hasMore = true;
  while (hasMore) {
    const { data } = await queryFn(offset);
    if (data && data.length > 0) {
      all = all.concat(data);
      offset += data.length;
      hasMore = data.length === BATCH_SIZE;
    } else {
      hasMore = false;
    }
  }
  return all;
}

/** Full slackUserId -> memberId map, same 3-tier matching (alias > email > normalized name) Wheel of Wonder uses. */
async function buildSlackUserIdToMemberIdMap(supabase: any): Promise<Map<string, string>> {
  const [allMembersResult, aliases, slackUsersResult] = await Promise.all([
    supabase.from("members").select("id, name, email"),
    fetchAllPaginated<{ member_id: string; alias: string; source: "zoom" | "slack" }>((offset) =>
      supabase.from("member_name_aliases").select("member_id, alias, source").range(offset, offset + BATCH_SIZE - 1)
    ),
    supabase.schema("bronze").from("slack_users").select("user_id, email, real_name"),
  ]);

  return matchSlackUsersToMembers(slackUsersResult.data ?? [], allMembersResult.data ?? [], aliases);
}

/** memberId -> slackUserId, for a specific set of members. */
export async function resolveSlackUserIds(supabase: any, memberIds: string[]): Promise<Map<string, string>> {
  const slackUserIdByMember = new Map<string, string>();
  if (memberIds.length === 0) return slackUserIdByMember;

  const memberIdSet = new Set(memberIds);
  const slackUserToMemberId = await buildSlackUserIdToMemberIdMap(supabase);
  for (const [slackUserId, memberId] of slackUserToMemberId) {
    if (memberIdSet.has(memberId)) slackUserIdByMember.set(memberId, slackUserId);
  }
  return slackUserIdByMember;
}

/** Reverse lookup for an inbound Slack interaction: the Slack user id we're handed, resolved to a member id. */
export async function resolveMemberIdForSlackUser(supabase: any, slackUserId: string): Promise<string | null> {
  const map = await buildSlackUserIdToMemberIdMap(supabase);
  return map.get(slackUserId) ?? null;
}
