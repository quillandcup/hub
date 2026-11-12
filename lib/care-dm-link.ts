/**
 * "Open the DM": the link from a Hedgie Care row to the Slack DM it follows (docs/HEDGIE_CARE.md). The choice of where it
 * leads is this one small function, so it can change when Hub Chat becomes the place for DMs.
 *
 * Today: **Hub Chat** when the Hub has the conversation and the viewer is in it (a Slack 1:1 DM is in a member's chat once
 * they have pulled their own DMs, `docs/SLACK_BRIDGED_CHAT.md`), else **Slack**. Never any message text, only ids: the Hub's
 * `/chat/<conversation id>` (a Tier 1 id, fine in a URL) or Slack's `app_redirect` with the DM's conversation id.
 */
import type { ChatRepository } from "@/lib/data/chat";

export type DmLink = { href: string; kind: "hub_chat" | "slack" };

/** Slack's documented way to open a conversation by id from a web link: `app_redirect?channel=<id>`, with `team=<id>` to name the workspace (it falls back to the person's default workspace without it). */
const SLACK_APP_REDIRECT = "https://slack.com/app_redirect";

/** The Slack workspace id (`SLACK_TEAM_ID`, optional), or null when it is not set: the link then lets Slack pick the person's default workspace. */
export function slackTeamId(): string | null {
  return process.env.SLACK_TEAM_ID || null;
}

/** Where "Open the DM" leads, for one DM: Hub Chat if the viewer can open it there, else Slack. */
export function dmLinkTarget(dm: { slackChannelId: string; hubChatChannelId: string | null; slackTeamId?: string | null }): DmLink {
  if (dm.hubChatChannelId) return { href: `/chat/${dm.hubChatChannelId}`, kind: "hub_chat" };
  const url = new URL(SLACK_APP_REDIRECT);
  url.searchParams.set("channel", dm.slackChannelId);
  if (dm.slackTeamId) url.searchParams.set("team", dm.slackTeamId);
  return { href: url.toString(), kind: "slack" };
}

/**
 * The links for these Slack DMs (by Slack conversation id), for the signed-in staff user `selfMemberId`. `chat` is read as
 * the viewer, so what row-level security hides is not offered; a Hub Chat link is given only for a conversation the viewer is
 * in now. Two reads for all of them, not one per DM.
 */
export async function resolveDmLinks(
  deps: { chat: Pick<ChatRepository, "idsBySlackChannels" | "joinedChannelIds">; selfMemberId: string | null; slackTeamId?: string | null },
  slackChannelIds: readonly string[]
): Promise<Map<string, DmLink>> {
  const out = new Map<string, DmLink>();
  if (slackChannelIds.length === 0) return out;
  const [hubIds, joined] = deps.selfMemberId
    ? await Promise.all([deps.chat.idsBySlackChannels([...slackChannelIds]), deps.chat.joinedChannelIds(deps.selfMemberId)])
    : [new Map<string, string>(), new Set<string>()];
  for (const slackChannelId of slackChannelIds) {
    const hub = hubIds.get(slackChannelId);
    out.set(slackChannelId, dmLinkTarget({ slackChannelId, hubChatChannelId: hub && joined.has(hub) ? hub : null, slackTeamId: deps.slackTeamId }));
  }
  return out;
}
