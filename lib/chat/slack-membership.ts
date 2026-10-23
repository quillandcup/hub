import { WebClient } from "@slack/web-api";
import type { SupabaseClient } from "@supabase/supabase-js";
import { chatSlackWritesEnabled } from "@/lib/chat/slack-post";

/**
 * Adding and removing people in a Slack conversation, for the Hub's members page (docs/SLACK_BRIDGED_CHAT.md,
 * "Membership"). The bot does it all: Slack has no way to add someone as someone else, and a member
 * leaving is the bot removing them (Slack shows "removed by Billie Bot"). Because the bot bypasses Slack's own
 * per-user permission checks, who may do what is decided in the Hub before anything gets here
 * (app/(member)/chat/membership-actions.ts). Service role.
 */

export type SlackMembershipResult = { ok: true } | { ok: false; error: string };

const slackError = (error: unknown): string | undefined => (error as { data?: { error?: string } } | null)?.data?.error;

/** The Slack account each member is, where the Hub has matched one (the same map the chat's authors come from). */
export async function slackUserIdsFor(service: SupabaseClient, memberIds: string[]): Promise<Map<string, string>> {
  const found = new Map<string, string>();
  if (memberIds.length === 0) return found;
  const { data } = await service.from("chat_slack_authors").select("slack_user_id, member_id").in("member_id", memberIds);
  for (const row of data ?? []) if (!found.has(row.member_id as string)) found.set(row.member_id as string, row.slack_user_id as string);
  return found;
}

const MISSING_BOT = "Slack isn't set up to do that.";

/** Why Slack refused, in words a member can act on. */
function inviteProblem(code: string | undefined): string {
  switch (code) {
    case "not_in_channel":
      return "Billie Bot isn't in this conversation, so it can't add people.";
    case "channel_not_found":
      return "Slack can't find this conversation.";
    case "is_archived":
      return "This conversation is archived in Slack.";
    case "user_is_restricted":
      return "Slack won't let that person be added: they are a guest with limited access.";
    case "cant_invite":
    case "cant_invite_self":
    case "no_permission":
    case "restricted_action":
      return "Slack won't let the people be added to this conversation.";
    case "user_not_found":
    case "users_list_not_supplied":
      return "Slack doesn't know one of those people.";
    case "missing_scope":
      return "Billie Bot needs a new permission in Slack to do that. Ask an admin to reinstall it.";
    default:
      return "Slack didn't add them. Try again in a moment.";
  }
}

function removeProblem(code: string | undefined): string {
  switch (code) {
    case "cant_kick_from_general":
      return "Slack doesn't allow removing people from the workspace's default channel.";
    case "cant_kick_self":
    case "no_permission":
    case "restricted_action":
      return "Slack won't let that person be removed from this conversation.";
    case "channel_not_found":
      return "Slack can't find this conversation.";
    case "missing_scope":
      return "Billie Bot needs a new permission in Slack to do that. Ask an admin to reinstall it.";
    default:
      return "Slack didn't remove them. Try again in a moment.";
  }
}

/** Add people (Slack user ids) to a conversation. Already being in it counts as done. */
export async function inviteToSlackChannel(opts: { channel: string; userIds: string[]; slack?: WebClient }): Promise<SlackMembershipResult> {
  if (opts.userIds.length === 0) return { ok: true };
  if (!chatSlackWritesEnabled()) return { ok: false, error: "People in Slack can only be added from the live Hub." };
  const token = process.env.SLACK_BOT_TOKEN;
  if (!opts.slack && !token) return { ok: false, error: MISSING_BOT };
  try {
    const slack = opts.slack ?? new WebClient(token);
    await slack.conversations.invite({ channel: opts.channel, users: opts.userIds.join(",") });
    return { ok: true };
  } catch (error) {
    const code = slackError(error);
    // One already in it doesn't fail the others in Slack's own answer, but a single invite says so.
    if (code === "already_in_channel") return { ok: true };
    console.error("conversations.invite failed:", code ?? error);
    return { ok: false, error: inviteProblem(code) };
  }
}

/** Remove one person (a Slack user id) from a conversation. Not being in it counts as done. */
export async function kickFromSlackChannel(opts: { channel: string; userId: string; slack?: WebClient }): Promise<SlackMembershipResult> {
  if (!chatSlackWritesEnabled()) return { ok: false, error: "People in Slack can only be removed from the live Hub." };
  const token = process.env.SLACK_BOT_TOKEN;
  if (!opts.slack && !token) return { ok: false, error: MISSING_BOT };
  try {
    const slack = opts.slack ?? new WebClient(token);
    await slack.conversations.kick({ channel: opts.channel, user: opts.userId });
    return { ok: true };
  } catch (error) {
    const code = slackError(error);
    if (code === "not_in_channel") {
      // Slack uses this for "the person isn't in it" (fine: that is what we wanted) and for "the bot isn't in it"
      // (not fine: nothing was removed). Ask which.
      try {
        const slack = opts.slack ?? new WebClient(token);
        const info = await slack.conversations.info({ channel: opts.channel });
        if (info.channel && "is_member" in info.channel && info.channel.is_member) return { ok: true };
      } catch (infoError) {
        console.error("conversations.info failed:", slackError(infoError) ?? infoError);
      }
      return { ok: false, error: "Billie Bot isn't in this conversation, so it can't remove people." };
    }
    console.error("conversations.kick failed:", code ?? error);
    return { ok: false, error: removeProblem(code) };
  }
}
