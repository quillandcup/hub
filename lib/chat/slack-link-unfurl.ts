import type { KnownBlock, WebClient } from "@slack/web-api";
import { hubLinkPath, parseHubLink, type HubLink } from "@/lib/chat/hub-links";
import { APP_URL, ORG_TIMEZONE } from "@/lib/config";
import type { Repos } from "@/lib/data/repos";
import { prickleTitle } from "@/lib/domain/prickle";
import { getMemberDisplayName } from "@/lib/member-display-name";

/**
 * Cards for links to the Hub, in Slack (docs/SLACK_BRIDGED_CHAT.md, "Hub links in Slack"). The Slack app registers the Hub's domain, Slack
 * sends a `link_shared` event for every link to it (typed in Slack by anyone, or in a Hub-written message), and the app answers with
 * `chat.unfurl`. With the domain registered Slack no longer crawls these links itself, so what is answered is all there is.
 *
 * Privacy is the whole point: an unfurl is seen by everyone in the Slack conversation, not by one reader, and the event says nothing about
 * who they are. So a card here may only hold what is safe to show anyone in a Slack conversation, decided from the link alone, with the
 * service role (there is no viewer): never a message's text, never an email, never an id that is not already in the link.
 * - a message: "A message from <display name> in #<channel> in Hub Chat", only for a public, not restricted channel, and only for a
 *   message that exists. Any other conversation (private, restricted, a direct or group message), a missing or deleted message: the neutral card;
 * - a prickle: its title and start, which are the community's public schedule; a member: the display name only (no photo, no profile text);
 * - anything else on the Hub's origin, or anything that cannot be read: the neutral card, "Link to the Hub".
 */

export const NEUTRAL_CARD_TEXT = "Link to the Hub";

/** A `link_shared` event, reduced to what is used. */
export interface LinkSharedEvent {
  channel: string;
  /** The message's ts (not a real one when `source` is `composer`). */
  messageTs: string;
  /** With `source`, names the link to unfurl even where `channel` and `ts` cannot (the composer, a conversation the bot is not in). */
  unfurlId: string | null;
  source: "composer" | "conversations_history" | null;
  /** The addresses, as written. */
  urls: string[];
}

/** The event as Slack sends it, or null when it is not one this can answer (so a hostile or odd payload does nothing). */
export function parseLinkShared(event: unknown): LinkSharedEvent | null {
  if (typeof event !== "object" || event === null) return null;
  const e = event as Record<string, unknown>;
  if (e.type !== "link_shared" || typeof e.channel !== "string" || typeof e.message_ts !== "string" || !Array.isArray(e.links)) return null;
  const urls = e.links.flatMap((l) => (typeof l === "object" && l !== null && typeof (l as { url?: unknown }).url === "string" ? [(l as { url: string }).url] : []));
  const source = e.source === "composer" || e.source === "conversations_history" ? e.source : null;
  return { channel: e.channel, messageTs: e.message_ts, unfurlId: typeof e.unfurl_id === "string" ? e.unfurl_id : null, source, urls };
}

/** The most links answered in one event. */
export const MAX_UNFURLS = 5;

/** One line of plain text for a card: no line breaks or control characters, and a sane length. Sent as `plain_text`, which Slack never reads as markup, so a name cannot add a mention, a link or formatting. */
export function cardLine(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 300);
}

const when = (iso: string) =>
  new Intl.DateTimeFormat("en-US", { timeZone: ORG_TIMEZONE, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" }).format(new Date(iso));

/** What the card for one link says, or the neutral text. Reads with the service role it is given; never throws. */
export async function slackCardText(repos: Pick<Repos, "chat" | "directory" | "prickles">, link: HubLink, opts: { descriptive: boolean }): Promise<string> {
  if (!opts.descriptive) return NEUTRAL_CARD_TEXT;
  try {
    switch (link.kind) {
      case "message": {
        const channel = await repos.chat.channelRecord(link.channelId);
        // Public and not restricted only: the name of a private conversation, and anything about a restricted or direct one, stays in the Hub.
        if (!channel || channel.kind !== "channel" || channel.visibility !== "public" || channel.restricted || !channel.name) return NEUTRAL_CARD_TEXT;
        const message = await repos.chat.messageById(channel.id, link.messageId);
        if (!message || message.deleted_at) return NEUTRAL_CARD_TEXT;
        const author = message.author_member_id ? await repos.directory.byId(message.author_member_id) : null;
        return author ? `A message from ${getMemberDisplayName(author)} in #${channel.name} in Hub Chat` : `A message in #${channel.name} in Hub Chat`;
      }
      case "prickle": {
        const prickle = await repos.prickles.byId(link.prickleId);
        return prickle ? `${prickleTitle(prickle)}, ${when(prickle.startTime)}` : NEUTRAL_CARD_TEXT;
      }
      case "member": {
        const member = await repos.directory.byId(link.memberId);
        return member ? `${getMemberDisplayName(member)} on the Hub` : NEUTRAL_CARD_TEXT;
      }
    }
  } catch (error) {
    // The address names a conversation, so only the kind is logged.
    console.error("[slack] a Hub link card could not be read (%s):", link.kind, error instanceof Error ? error.message : "unknown error");
    return NEUTRAL_CARD_TEXT;
  }
}

/** The unfurl for one address: the text as plain text, and (for a page we know) a link built from the parsed ids. */
function unfurlFor(text: string, link: HubLink | null) {
  const blocks: KnownBlock[] = [{ type: "section", text: { type: "plain_text", text: cardLine(text), emoji: false } }];
  if (link) blocks.push({ type: "context", elements: [{ type: "mrkdwn", text: `<${APP_URL}${hubLinkPath(link)}|Open in the Hub>` }] });
  return { blocks };
}

export type UnfurlResult = { status: "unfurled"; count: number } | { status: "nothing" } | { status: "failed"; code: string };

/**
 * Answers one `link_shared` event: a card for each link on the Hub's origin (at most {@link MAX_UNFURLS}), by `unfurl_id` and `source` when Slack
 * gave them, else by channel and ts. Links on any other host are left alone. `descriptive` is whether cards may say what the page is (the
 * `chat_link_cards` flag, on for everyone); off, every link gets the neutral card, which still beats the crawler's sign-in page.
 */
export async function unfurlHubLinks(
  event: LinkSharedEvent,
  deps: { repos: Pick<Repos, "chat" | "directory" | "prickles">; slack: Pick<WebClient, "chat">; descriptive: boolean },
): Promise<UnfurlResult> {
  const unfurls: Record<string, ReturnType<typeof unfurlFor>> = {};
  for (const url of event.urls) {
    if (Object.keys(unfurls).length >= MAX_UNFURLS) break;
    let own = false;
    try {
      own = new URL(url).origin === new URL(APP_URL).origin;
    } catch {
      own = false;
    }
    if (!own || unfurls[url]) continue;
    const link = parseHubLink(url, APP_URL);
    unfurls[url] = unfurlFor(link ? await slackCardText(deps.repos, link, { descriptive: deps.descriptive }) : NEUTRAL_CARD_TEXT, link);
  }
  if (Object.keys(unfurls).length === 0) return { status: "nothing" };
  try {
    const target = event.unfurlId && event.source ? { unfurl_id: event.unfurlId, source: event.source } : { channel: event.channel, ts: event.messageTs };
    const response = await deps.slack.chat.unfurl({ ...target, unfurls });
    return response.ok ? { status: "unfurled", count: Object.keys(unfurls).length } : { status: "failed", code: String(response.error ?? "unknown") };
  } catch (error) {
    // Slack's own error code (`cannot_unfurl_url`, `missing_scope`...), never the addresses.
    const code = typeof error === "object" && error !== null && "data" in error ? String((error as { data?: { error?: unknown } }).data?.error ?? "unknown") : "unknown";
    return { status: "failed", code };
  }
}
