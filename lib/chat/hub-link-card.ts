import { bodyOf, botOf, contentOf, loadChannelForMember, type ChatLoadRepos } from "@/lib/chat/load";
import { parseHubLink, type HubLink } from "@/lib/chat/hub-links";
import { slackAuthorIdsByTs, slackChannelNames, slackUserNames } from "@/lib/chat/names";
import { decodeEntities, mentionedChannelIds, mentionedUserIds, mentionsToPlainText } from "@/lib/chat/render";
import type { Repos } from "@/lib/data/repos";
import { getMemberDisplayName } from "@/lib/member-display-name";
import { prickleTitle } from "@/lib/domain/prickle";
import { safeUrl } from "@/lib/url";

/**
 * What the card for a link to the Hub shows one viewer (docs/SLACK_BRIDGED_CHAT.md, "Hub links"), decided here on the server with every read
 * made as the viewer, so row-level security answers for them. A target the viewer may not see, one that is not there and one that was
 * deleted all come back as the same `stub`, so a card says nothing about what a private conversation holds. Nothing here is a Tier 2 id, an
 * email or a token: the card carries names, a time, an excerpt and a title.
 */

/** The excerpt of a quoted message is cut here, on a word where it can be. */
export const MAX_EXCERPT = 280;

export type HubCard =
  /** Nothing to show this viewer: the card says it is a link to the Hub and opens it. */
  | { state: "stub" }
  | { state: "message"; authorName: string; authorPhotoUrl: string | null; postedAt: string; text: string; channelName: string | null }
  | { state: "prickle"; title: string; startTime: string }
  | { state: "member"; name: string; photoUrl: string | null };

const STUB: HubCard = { state: "stub" };

export interface HubCardViewer {
  memberId: string;
  isSudo: boolean;
}

type CardRepos = ChatLoadRepos & Pick<Repos, "prickles">;

/** A message's text as one short plain line of prose: Slack's escapes decoded, mentions as names, links as their label, emphasis marks off. */
export function messageExcerpt(body: string, names: { userNames: Record<string, string>; channelNames: Record<string, string> }): string {
  const plain = decodeEntities(
    mentionsToPlainText(body, names)
      .replace(/<(?:https?:\/\/|mailto:)[^|>\s]*\|([^>]*)>/g, "$1")
      .replace(/<((?:https?:\/\/|mailto:)[^>\s]*)>/g, "$1"),
  )
    .replace(/(^|[\s(])([*_~])(?=\S)(.+?)(?<=\S)\2(?=$|[\s.,!?;:)])/g, "$1$3")
    .replace(/\s+/g, " ")
    .trim();
  if (plain.length <= MAX_EXCERPT) return plain;
  const cut = plain.slice(0, MAX_EXCERPT);
  const at = cut.lastIndexOf(" ");
  return `${(at > MAX_EXCERPT * 0.6 ? cut.slice(0, at) : cut).trimEnd()}…`;
}

async function messageCard(repos: CardRepos, link: Extract<HubLink, { kind: "message" }>, viewer: HubCardViewer): Promise<HubCard> {
  // The conversation as this viewer may enter it: not a private one they are not in, not a direct message while viewing as someone else, and (the page's own
  // rule) not a restricted one in sudo, which staff may not read as a member.
  const channel = await loadChannelForMember(repos, link.channelId, viewer.memberId, viewer.isSudo);
  if (!channel || (viewer.isSudo && channel.restricted)) return STUB;
  const row = await repos.chat.messageById(channel.id, link.messageId).catch(() => null);
  // No content row is what row-level security shows for a message the viewer may not read (a restricted conversation, for one).
  if (!row || row.deleted_at) return STUB;
  const body = bodyOf(row);
  if (body === null) return STUB;

  const content = contentOf(row);
  const bot = botOf(content?.bot);
  let authorName = bot?.name ?? "Someone on Slack";
  let authorPhotoUrl: string | null = null;
  if (row.author_member_id) {
    const author = await repos.directory.byId(row.author_member_id).catch(() => null);
    if (author) {
      authorName = getMemberDisplayName(author);
      authorPhotoUrl = safeUrl(author.photo_url);
    }
  } else if (!bot && channel.slackChannelId && row.slack_ts) {
    const slackUser = (await slackAuthorIdsByTs(channel.slackChannelId, [row.slack_ts]).catch(() => ({}) as Record<string, string>))[row.slack_ts];
    if (slackUser) authorName = (await slackUserNames([slackUser]).catch(() => ({}) as Record<string, string>))[slackUser] ?? authorName;
  }

  const [userNames, channelNames] = await Promise.all([
    slackUserNames(mentionedUserIds(body)).catch(() => ({}) as Record<string, string>),
    slackChannelNames(mentionedChannelIds(body)).catch(() => ({}) as Record<string, string>),
  ]);
  return {
    state: "message",
    authorName,
    authorPhotoUrl,
    postedAt: row.created_at,
    text: messageExcerpt(body, { userNames, channelNames }),
    // The conversation's name only for a channel the viewer may see; a direct or group message has no name worth repeating back to a participant.
    channelName: channel.kind === "channel" ? channel.label.replace(/^#/, "") : null,
  };
}

/** What the card for this address shows this viewer; null when the address is not one of the Hub's card links. */
export async function loadHubLinkCard(repos: CardRepos, viewer: HubCardViewer, address: string, appUrl: string): Promise<HubCard | null> {
  const link = parseHubLink(address, appUrl);
  if (!link) return null;
  try {
    switch (link.kind) {
      case "message":
        return await messageCard(repos, link, viewer);
      case "prickle": {
        // The prickle page is open to every signed-in member (the read is as the viewer, so a prickle that is gone is the stub).
        const prickle = await repos.prickles.byId(link.prickleId);
        return prickle ? { state: "prickle", title: prickleTitle(prickle), startTime: prickle.startTime } : STUB;
      }
      case "member": {
        // The member directory is what the profile page reads: every signed-in member sees the same public profile.
        const member = await repos.directory.byId(link.memberId);
        return member ? { state: "member", name: getMemberDisplayName(member), photoUrl: safeUrl(member.photo_url) } : STUB;
      }
    }
  } catch (error) {
    // The address names a conversation, so only the kind is logged.
    console.error("[chat] a %s card could not be read:", link.kind, error instanceof Error ? error.message : "unknown error");
    return STUB;
  }
}
