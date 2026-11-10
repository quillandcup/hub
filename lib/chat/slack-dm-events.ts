import type { SupabaseClient } from "@supabase/supabase-js";
import { createRepos } from "@/lib/data/repos";
import { membersWithFeatureForOutreach } from "@/lib/features.server";
import { getSlackConnectionStatus } from "@/lib/slack-connect";
import { isSlackDmChannelId } from "@/lib/slack-messages";

/**
 * Live delivery of Slack DMs (docs/SLACK_BRIDGED_CHAT.md, "Slack 1:1 DMs through members' own tokens"). The app
 * subscribes to `message.im` on behalf of users (`user_events`), so Slack sends one event for every DM message
 * of every member who authorized it, whatever the `slack_dm_bridge` feature says. This decides what the
 * webhook does with such an event, so the feature stays the only switch: a DM is kept only when a member it
 * covers, with the DM permissions, can see it.
 */

export interface SlackAuthorization {
  user_id?: string;
  is_bot?: boolean;
}

export type DmEventDecision =
  /** Not a member's DM event (a channel message, or a DM with the bot): handled as always. */
  | { kind: "not_dm" }
  /** A member's DM that no covered member can see: ignored, nothing stored. */
  | { kind: "drop" }
  /** A DM of a covered member that is already in the chat: stored and projected like any message. */
  | { kind: "keep" }
  /** A DM the chat hasn't seen yet: its first message tells us nothing of who is in it, so the member's DMs are pulled. */
  | { kind: "pull"; memberId: string };

export { isSlackDmChannelId };

export async function decideDmEvent(
  service: SupabaseClient,
  payload: { event?: { type?: unknown; channel?: unknown; channel_type?: unknown; item?: { channel?: unknown } }; authorizations?: SlackAuthorization[] }
): Promise<DmEventDecision> {
  const event = payload.event;
  if (!event) return { kind: "not_dm" };
  // A reaction names its conversation in `item`, a message in `channel`.
  const channel = event.channel ?? event.item?.channel;
  const authorizations = payload.authorizations ?? [];
  // A DM with the bot (delivered as a bot event) and an event with nobody named: the way it has always been handled.
  const forTheBot = authorizations.length === 0 || authorizations.some((a) => a.is_bot);
  const isDm = event.channel_type === "im" || isSlackDmChannelId(channel);
  if (!isDm) {
    // A reaction delivered on a member's behalf anywhere else is the bot's to record (its own reaction events cover those channels): drop the copy.
    const isReaction = event.type === "reaction_added" || event.type === "reaction_removed";
    return isReaction && !forTheBot ? { kind: "drop" } : { kind: "not_dm" };
  }
  if (forTheBot) return { kind: "not_dm" };

  const repos = createRepos(service);
  const slackUserIds = authorizations.map((a) => a.user_id).filter((id): id is string => typeof id === "string" && id !== "");
  const memberIds = [...(await repos.chat.memberIdsBySlackUser(slackUserIds)).values()];
  const covered = [...(await membersWithFeatureForOutreach(repos, "slack_dm_bridge", memberIds))];
  const allowed: string[] = [];
  for (const memberId of covered) {
    if ((await getSlackConnectionStatus(service, memberId)).hasDmScopes) allowed.push(memberId);
  }
  if (allowed.length === 0) return { kind: "drop" };

  const known = typeof channel === "string" ? await repos.slackWorkspace.channelById(channel) : null;
  return known?.is_im ? { kind: "keep" } : { kind: "pull", memberId: allowed[0] };
}
