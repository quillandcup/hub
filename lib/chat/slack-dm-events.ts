import type { SupabaseClient } from "@supabase/supabase-js";
import { createRepos } from "@/lib/data/repos";
import { membersWithFeatureForOutreach } from "@/lib/features.server";
import { getSlackConnectionStatus } from "@/lib/slack-connect";

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

/** A message event in a 1:1 DM (Slack's `D…` conversations). */
export const isSlackDmChannelId = (channelId: unknown): boolean => typeof channelId === "string" && /^D[A-Z0-9]+$/.test(channelId);

export async function decideDmEvent(
  service: SupabaseClient,
  payload: { event?: { channel?: unknown; channel_type?: unknown }; authorizations?: SlackAuthorization[] }
): Promise<DmEventDecision> {
  const event = payload.event;
  if (!event || (event.channel_type !== "im" && !isSlackDmChannelId(event.channel))) return { kind: "not_dm" };
  const authorizations = payload.authorizations ?? [];
  // A DM with the bot (delivered as a bot event) and an event with nobody named: the way it has always been handled.
  if (authorizations.length === 0 || authorizations.some((a) => a.is_bot)) return { kind: "not_dm" };

  const repos = createRepos(service);
  const slackUserIds = authorizations.map((a) => a.user_id).filter((id): id is string => typeof id === "string" && id !== "");
  const memberIds = [...(await repos.chat.memberIdsBySlackUser(slackUserIds)).values()];
  const covered = [...(await membersWithFeatureForOutreach(repos, "slack_dm_bridge", memberIds))];
  const allowed: string[] = [];
  for (const memberId of covered) {
    if ((await getSlackConnectionStatus(service, memberId)).hasDmScopes) allowed.push(memberId);
  }
  if (allowed.length === 0) return { kind: "drop" };

  const known = typeof event.channel === "string" ? await repos.slackWorkspace.channelById(event.channel) : null;
  return known?.is_im ? { kind: "keep" } : { kind: "pull", memberId: allowed[0] };
}
