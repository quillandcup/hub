import type { SupabaseClient } from "@supabase/supabase-js";
import { createRepos } from "@/lib/data/repos";
import type { Db } from "@/lib/data/db";
import type { MembershipChange } from "@/lib/chat/transport";
import { getSlackUserToken } from "@/lib/slack-connect";
import {
  inviteAsMember,
  inviteToSlackChannel,
  joinAsMember,
  kickAsMember,
  kickFromSlackChannel,
  leaveSlackChannelAsMember,
  slackUserIdsFor,
  type AsMemberResult,
  type SlackMembershipResult,
} from "./membership";

/** The chat port's membership methods over the Slack calls in ./membership: who acts (the member's own link, else the app) is Slack's business. */

const RECONNECT_HINT = " Reconnect Slack in Settings to do this as yourself.";

/**
 * Do something in Slack as the acting member when they've connected their account (so Slack attributes it to
 * them and applies its rules to them), and as the bot when they haven't or their token can't do it. Slack's own
 * refusal to the member's account is returned as is, not overridden by the bot. A token Slack says is dead is
 * revoked so Settings stops saying it's connected, and `reconnect` says to tell the member.
 */
async function asMemberElseBot(
  service: SupabaseClient,
  actorId: string,
  own: (token: string) => Promise<AsMemberResult>,
  bot: () => Promise<SlackMembershipResult>
): Promise<MembershipChange> {
  let reconnect = false;
  const connection = await getSlackUserToken(service, actorId);
  if (connection) {
    const tried = await own(connection.token);
    if (tried.ok) return { result: tried, reconnect };
    if (!tried.retryWithBot) return { result: tried, reconnect };
    if (tried.deadToken) {
      await service.rpc("slack_connection_revoke", { p_member: actorId });
      reconnect = true;
    }
  }
  const result = await bot();
  return { result: !result.ok && reconnect ? { ok: false, error: result.error + RECONNECT_HINT } : result, reconnect };
}

/** The port's `externalIdsFor`: the Slack user id of each member the Hub has matched to one. */
export const slackIdsForMembers = (db: SupabaseClient, memberIds: string[]) => slackUserIdsFor(createRepos(db as unknown as Db), memberIds);

/** The port's `addToConversation`. Joining yourself to a public channel is a join, not an invite; adding others is an invite by you. */
export function addToSlackConversation(db: SupabaseClient, opts: { actorMemberId: string; channelRef: string; externalUserIds: string[]; selfJoin: boolean }): Promise<MembershipChange> {
  return asMemberElseBot(
    db,
    opts.actorMemberId,
    (token) => (opts.selfJoin ? joinAsMember({ channel: opts.channelRef, token }) : inviteAsMember({ channel: opts.channelRef, userIds: opts.externalUserIds, token })),
    () => inviteToSlackChannel({ channel: opts.channelRef, userIds: opts.externalUserIds })
  );
}

/** The port's `removeFromConversation`: leaving as yourself, or removing someone (as you, else as the bot). */
export function removeFromSlackConversation(db: SupabaseClient, opts: { actorMemberId: string; channelRef: string; externalUserId: string; self: boolean }): Promise<MembershipChange> {
  return asMemberElseBot(
    db,
    opts.actorMemberId,
    (token) => (opts.self ? leaveSlackChannelAsMember({ channel: opts.channelRef, token }) : kickAsMember({ channel: opts.channelRef, userId: opts.externalUserId, token })),
    () => kickFromSlackChannel({ channel: opts.channelRef, userId: opts.externalUserId })
  );
}
