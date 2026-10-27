import { createRepos } from "@/lib/data/repos";
import { createServiceRoleClient } from "@/lib/supabase/service";

/**
 * Slack DM links for the given members, for member-facing pages (e.g. sister streaks).
 *
 * Resolving a member's Slack user needs data a member session can't read -- other members'
 * Slack aliases, their emails, and bronze.slack_users are all admin-only under RLS -- so this
 * reads them server-side with the service role and returns ONLY the resulting
 * `slack.com/app_redirect` URLs (which carry just a Slack user id, already visible to anyone in
 * the workspace). Emails and aliases never leave this function.
 *
 * Precedence: confirmed Slack alias, then email match against bronze.slack_users.
 */
export async function getSlackDmLinksForMembers(memberIds: string[]): Promise<Map<string, string>> {
  const links = new Map<string, string>();
  if (memberIds.length === 0) return links;

  const service = createServiceRoleClient();
  const repos = createRepos(service);
  const [slackAliases, members] = await Promise.all([repos.aliases.slackLinks(memberIds), repos.members.byIds(memberIds)]);

  for (const a of slackAliases) {
    links.set(a.member_id, `https://quillandcup.slack.com/app_redirect?channel=${a.alias}`);
  }

  const unmatched = members.filter((m) => !links.has(m.id) && m.email);
  if (unmatched.length > 0) {
    const memberIdByEmail = new Map(unmatched.map((m) => [m.email as string, m.id as string]));
    const { data: slackUsers } = await service
      .schema("bronze")
      .from("slack_users")
      .select("user_id, email")
      .in("email", [...memberIdByEmail.keys()]);
    for (const u of slackUsers ?? []) {
      const memberId = u.email ? memberIdByEmail.get(u.email) : undefined;
      if (memberId) links.set(memberId, `https://quillandcup.slack.com/app_redirect?channel=${u.user_id}`);
    }
  }

  return links;
}
