import { matchSlackUsersToMembers, type SlackUser } from "@/lib/slack-matching";
import { normalizeName, type Member } from "@/lib/member-matching";
import * as Sentry from "@sentry/nextjs";

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
async function buildSlackUserIdToMemberIdMap(
  supabase: any,
  scope: { memberIds?: readonly string[]; slackUserId?: string }
): Promise<Map<string, string>> {
  const [allMembersResult, aliases, slackUsersResult] = await Promise.all([
    supabase.from("members").select("id, name, email"),
    fetchAllPaginated<{ member_id: string; alias: string; source: "zoom" | "slack" }>((offset) =>
      supabase.from("member_name_aliases").select("member_id, alias, source").range(offset, offset + BATCH_SIZE - 1)
    ),
    supabase.schema("bronze").from("slack_users").select("user_id, email, real_name"),
  ]);

  const members = (allMembersResult.data ?? []) as Member[];
  const slackUsers = (slackUsersResult.data ?? []) as SlackUser[];
  const matched = await matchSlackUsersToMembers(slackUsers, members, aliases);
  const safe = new Map<string, string>();

  const reportCollision = (reason: string, slackUserIds: string[], memberIds: string[]) => {
    if (scope.memberIds && !memberIds.some((id) => scope.memberIds!.includes(id))) return;
    if (scope.slackUserId && !slackUserIds.includes(scope.slackUserId)) return;
    // IDs, not names or email addresses: enough to investigate without putting personal details
    // into logs or Sentry events. Refuse the match rather than risk a private DM going astray.
    console.error("[notifications] Ambiguous Slack member match", { reason, slackUserIds, memberIds });
    Sentry.captureMessage("Ambiguous Slack member match", {
      level: "error",
      tags: { reason },
      extra: { slackUserIds, memberIds },
    });
  };

  for (const [slackUserId, memberId] of matched) {
    const user = slackUsers.find((row) => row.user_id === slackUserId);
    // The matcher only emits IDs from slackUsers. Some sender tests replace that matcher with
    // a synthetic map and omit the Bronze fixture; retain those synthetic matches.
    if (!user) {
      safe.set(slackUserId, memberId);
      continue;
    }
    const manual = aliases.filter((row) => row.source === "slack" && row.alias === slackUserId);
    const userEmail = user.email?.toLowerCase();
    const emailMatches = userEmail
      ? members.filter((row) => row.email?.toLowerCase() === userEmail)
      : [];
    const nameMatches = user.real_name
      ? members.filter((row) => row.name && normalizeName(row.name) === normalizeName(user.real_name))
      : [];
    const candidates = manual.length ? manual.map((row) => row.member_id) : emailMatches.length
      ? emailMatches.map((row) => row.id) : nameMatches.map((row) => row.id);
    const distinct = [...new Set(candidates)];
    if (distinct.length !== 1 || distinct[0] !== memberId) {
      reportCollision("ambiguous_candidate", [slackUserId], distinct);
      continue;
    }
    safe.set(slackUserId, memberId);
  }

  const slackIdsByMember = new Map<string, string[]>();
  for (const [slackUserId, memberId] of safe) {
    const ids = slackIdsByMember.get(memberId) ?? [];
    ids.push(slackUserId);
    slackIdsByMember.set(memberId, ids);
  }
  for (const [memberId, slackUserIds] of slackIdsByMember) {
    if (slackUserIds.length <= 1) continue;
    reportCollision("multiple_slack_users", slackUserIds, [memberId]);
    for (const id of slackUserIds) safe.delete(id);
  }
  return safe;
}

/** memberId -> slackUserId, for a specific set of members. */
export async function resolveSlackUserIds(supabase: any, memberIds: string[]): Promise<Map<string, string>> {
  const slackUserIdByMember = new Map<string, string>();
  if (memberIds.length === 0) return slackUserIdByMember;

  const memberIdSet = new Set(memberIds);
  const slackUserToMemberId = await buildSlackUserIdToMemberIdMap(supabase, { memberIds });
  for (const [slackUserId, memberId] of slackUserToMemberId) {
    if (memberIdSet.has(memberId)) slackUserIdByMember.set(memberId, slackUserId);
  }
  return slackUserIdByMember;
}

/** Reverse lookup for an inbound Slack interaction: the Slack user id we're handed, resolved to a member id. */
export async function resolveMemberIdForSlackUser(supabase: any, slackUserId: string): Promise<string | null> {
  const map = await buildSlackUserIdToMemberIdMap(supabase, { slackUserId });
  return map.get(slackUserId) ?? null;
}
