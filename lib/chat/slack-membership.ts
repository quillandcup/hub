import { WebClient } from "@slack/web-api";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createRepos } from "@/lib/data/repos";
import { chatSlackWritesEnabled } from "@/lib/chat/slack-post";
import { isDeadTokenError } from "@/lib/slack-connect";
import { getSlackBotToken } from "@/lib/slack-bot-token";

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
  if (memberIds.length === 0) return new Map();
  // A failed lookup reads as nobody matched (the callers then say so), as it always has.
  return createRepos(service).chat.slackUserIdsByMember(memberIds).catch((error: Error) => {
    console.error("looking up the Slack accounts of members failed:", error.message);
    return new Map<string, string>();
  });
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
    case "restricted_action":
      return "Your Slack workspace limits who can remove people from channels, so Billie Bot can't.";
    case "cant_kick_self":
    case "no_permission":
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
  const token = await getSlackBotToken();
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
  const token = await getSlackBotToken();
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

/** What a try with a member's own Slack token came to. `retryWithBot`: the token or its reach wasn't enough, so the bot should try; `deadToken`: the connection no longer works at all. */
export type AsMemberResult = SlackMembershipResult & { retryWithBot?: boolean; deadToken?: boolean };

function asMemberFailure(code: string | undefined, error: unknown, notInChannelToBot: boolean): AsMemberResult {
  if (isDeadTokenError(error)) return { ok: false, error: "Your Slack connection stopped working.", retryWithBot: true, deadToken: true };
  if (code === "missing_scope" || (notInChannelToBot && code === "not_in_channel")) return { ok: false, error: "Slack didn't let you do that.", retryWithBot: true };
  if (code === "channel_not_found") return { ok: false, error: "Slack can't find this conversation." };
  if (code === "is_archived") return { ok: false, error: "This conversation is archived in Slack." };
  if (code === "cant_leave_general" || code === "cant_kick_from_general") return { ok: false, error: "Slack doesn't allow removing people from the workspace's default channel." };
  if (code === "restricted_action" || code === "no_permission") return { ok: false, error: "Your Slack workspace doesn't let you remove people from this channel." };
  return { ok: false, error: "Slack didn't do that. Try again in a moment." };
}

/**
 * A member leaving a conversation as themselves, with their own Slack token (`conversations.leave`). Unlike the
 * bot's kick it isn't held back by a workspace rule on who may remove people.
 */
export async function leaveSlackChannelAsMember(opts: { channel: string; token: string; slack?: WebClient }): Promise<AsMemberResult> {
  if (!chatSlackWritesEnabled()) return { ok: false, error: "People in Slack can only be removed from the live Hub." };
  try {
    const slack = opts.slack ?? new WebClient(opts.token);
    await slack.conversations.leave({ channel: opts.channel });
    return { ok: true };
  } catch (error) {
    const code = slackError(error);
    if (code === "not_in_channel") return { ok: true };
    console.error("conversations.leave failed:", code ?? error);
    return asMemberFailure(code, error, false);
  }
}

/**
 * Staff removing someone as themselves, with their own Slack token, so Slack applies the rules to them
 * rather than to the bot. Anything that stops it for the token's sake (dead, missing scope, or not being
 * in the conversation themselves) hands over to the bot.
 */
export async function kickAsMember(opts: { channel: string; userId: string; token: string; slack?: WebClient }): Promise<AsMemberResult> {
  if (!chatSlackWritesEnabled()) return { ok: false, error: "People in Slack can only be removed from the live Hub." };
  try {
    const slack = opts.slack ?? new WebClient(opts.token);
    await slack.conversations.kick({ channel: opts.channel, user: opts.userId });
    return { ok: true };
  } catch (error) {
    const code = slackError(error);
    console.error("conversations.kick as member failed:", code ?? error);
    return asMemberFailure(code, error, true);
  }
}

/**
 * Adding people as the member, with their own Slack token, so Slack shows them as the one who added them.
 * A token that can't do it (dead, missing the scope, not in the conversation themselves) hands over to the bot.
 */
export async function inviteAsMember(opts: { channel: string; userIds: string[]; token: string; slack?: WebClient }): Promise<AsMemberResult> {
  if (opts.userIds.length === 0) return { ok: true };
  if (!chatSlackWritesEnabled()) return { ok: false, error: "People in Slack can only be added from the live Hub." };
  try {
    const slack = opts.slack ?? new WebClient(opts.token);
    await slack.conversations.invite({ channel: opts.channel, users: opts.userIds.join(",") });
    return { ok: true };
  } catch (error) {
    const code = slackError(error);
    if (code === "already_in_channel") return { ok: true };
    console.error("conversations.invite as member failed:", code ?? error);
    if (isDeadTokenError(error)) return { ok: false, error: "Your Slack connection stopped working.", retryWithBot: true, deadToken: true };
    if (code === "missing_scope" || code === "not_in_channel") return { ok: false, error: "Slack didn't let you do that.", retryWithBot: true };
    return { ok: false, error: inviteProblem(code) };
  }
}

/** A member joining a public channel as themselves (`conversations.join`); a token that can't hands over to the bot. */
export async function joinAsMember(opts: { channel: string; token: string; slack?: WebClient }): Promise<AsMemberResult> {
  if (!chatSlackWritesEnabled()) return { ok: false, error: "People in Slack can only be added from the live Hub." };
  try {
    const slack = opts.slack ?? new WebClient(opts.token);
    await slack.conversations.join({ channel: opts.channel });
    return { ok: true };
  } catch (error) {
    const code = slackError(error);
    console.error("conversations.join failed:", code ?? error);
    if (isDeadTokenError(error)) return { ok: false, error: "Your Slack connection stopped working.", retryWithBot: true, deadToken: true };
    if (code === "missing_scope" || code === "method_not_supported_for_channel_type") return { ok: false, error: "Slack didn't let you do that.", retryWithBot: true };
    if (code === "channel_not_found") return { ok: false, error: "Slack can't find this conversation." };
    if (code === "is_archived") return { ok: false, error: "This conversation is archived in Slack." };
    return { ok: false, error: "Slack didn't let you join. Try again in a moment." };
  }
}
