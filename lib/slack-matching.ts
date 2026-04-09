import { Member, MemberAlias, normalizeName } from './member-matching';

export interface SlackUser {
  user_id: string;
  email: string | null;
  real_name: string;
}

export interface SlackMatchResult {
  slack_user_id: string;
  member_id: string | null;
  match_method: 'manual_alias' | 'email' | 'normalized_name' | null;
}

/**
 * Matches Slack users to members
 *
 * Matching priority:
 * 1. Manual alias (slack user_id → member_id in member_name_aliases)
 * 2. Email match (slack email = member email)
 * 3. Normalized name match
 *
 * Returns Map: slack_user_id → member_id
 */
export async function matchSlackUsersToMembers(
  slackUsers: SlackUser[],
  members: Member[],
  aliases: MemberAlias[]
): Promise<Map<string, string>> {
  const map = new Map<string, string>();

  // Build lookup maps
  const membersByEmail = new Map<string, Member>();
  const membersByNormalizedName = new Map<string, Member>();
  const slackAliasToMemberId = new Map<string, string>();

  for (const member of members) {
    membersByEmail.set(member.email.toLowerCase(), member);
    membersByNormalizedName.set(normalizeName(member.name), member);
  }

  for (const alias of aliases) {
    if (alias.source === 'slack') {
      slackAliasToMemberId.set(alias.alias, alias.member_id);
    }
  }

  // Match each Slack user
  for (const slackUser of slackUsers) {
    let memberId: string | null = null;

    // 1. Manual alias (highest priority)
    if (slackAliasToMemberId.has(slackUser.user_id)) {
      memberId = slackAliasToMemberId.get(slackUser.user_id)!;
    }

    // 2. Email match
    if (!memberId && slackUser.email) {
      const member = membersByEmail.get(slackUser.email.toLowerCase());
      if (member) {
        memberId = member.id;
      }
    }

    // 3. Normalized name match
    if (!memberId && slackUser.real_name) {
      const member = membersByNormalizedName.get(normalizeName(slackUser.real_name));
      if (member) {
        memberId = member.id;
      }
    }

    if (memberId) {
      map.set(slackUser.user_id, memberId);
    }
  }

  return map;
}

/**
 * Returns unmatched Slack users (for data hygiene UI)
 */
export function getUnmatchedSlackUsers(
  slackUsers: SlackUser[],
  matchedUserIds: Set<string>
): SlackUser[] {
  return slackUsers.filter(u => !matchedUserIds.has(u.user_id));
}
