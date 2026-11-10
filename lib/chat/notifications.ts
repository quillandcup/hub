import type { Repos } from "@/lib/data/repos";
import type { ChatNotificationContext, NotifiableMember } from "@/lib/data/chat";
import type { ChannelId, OutboundMessage } from "@/lib/channels";
import { APP_URL } from "@/lib/config";
import { clock } from "@/lib/clock";
import { createNotifier } from "@/lib/notifications/notify";
import type { ChatNotificationKindId } from "@/lib/notifications/registry";
import { membersWithFeature } from "@/lib/features.server";
import { getMemberDisplayName } from "@/lib/member-display-name";
import { mentionedUserIds } from "@/lib/chat/render";

/**
 * Hub chat notifications: a new direct message, a mention in a channel, and a message in a channel the member follows
 * (docs/SLACK_BRIDGED_CHAT.md, "Notifications"). Sent only through createNotifier, so they honor each member's per-kind
 * channels (all off until "Hub chat is my main place" turns them on) and show in Admin -> Test Notifications.
 *
 * A message is considered once it is stored and projected into the chat: from the Slack webhook, from a member's DM pull and
 * from a Hub post. The rules, in order (decideChatNotifications):
 *  - nothing for a Slack notice, a deleted message, an archived conversation, or a message older than MAX_AGE (a re-pull of
 *    history must not ping), and never for the author's own messages or for a member who has muted the conversation;
 *  - only for members in the conversation (their rows decide who can see it: a Slack DM is in the chat of the members who pulled it);
 *  - a mention (or @channel/@here in a channel) notifies as a mention, wherever the conversation's setting stands short of muted;
 *  - otherwise a direct message notifies for every message, and a channel only for members who set it to "all", and only for
 *    top-level messages (a thread's replies would be too many);
 *  - one notification per conversation until it is read: the claim key is the conversation and the member's read marker, so a burst,
 *    a webhook retry and a re-pull are all the same claim, and reading (which moves the marker) makes the next message new.
 * The notification carries who and where, never any of the message's text (a direct message is restricted content).
 */

/** A message older than this does not notify: it came with a catch-up or a re-pull, not a conversation in progress. */
export const CHAT_NOTIFY_MAX_AGE_MS = 30 * 60 * 1000;

/** The claim kind in notification_log (one per conversation and unread stretch, whichever chat kind sent it). */
export const CHAT_UNREAD_CLAIM_KIND = "chat_unread";

/** In-app notifications of a conversation share this ref, so reading the conversation resolves them. */
export const chatNotificationRef = (channelId: string) => `chat:${channelId}`;

export const chatConversationUrl = (channelId: string | null, threadRootId?: string | null) =>
  channelId ? `${APP_URL}/chat/${channelId}${threadRootId ? `?thread=${threadRootId}` : ""}` : `${APP_URL}/chat`;

const EVERYONE_MENTION = /<!(?:channel|here|everyone)(?:\|[^>]*)?>/;

export interface ChatNotifyDecision {
  memberId: string;
  kind: ChatNotificationKindId;
  /** In words, for the dry-run log. */
  why: string;
  /** The read marker the claim is keyed to. */
  readMarker: string;
}

export interface DecideInput {
  context: ChatNotificationContext;
  members: NotifiableMember[];
  mentionedMemberIds: ReadonlySet<string>;
  mentionsEveryone: boolean;
  now: Date;
}

/** Who this message is for and as which kind. Pure: no I/O, so every rule is a unit test. */
export function decideChatNotifications({ context, members, mentionedMemberIds, mentionsEveryone, now }: DecideInput): ChatNotifyDecision[] {
  const { message, channel } = context;
  if (message.systemSubtype || message.deletedAt || channel.archivedAt) return [];
  const created = Date.parse(message.createdAt);
  if (Number.isNaN(created) || now.getTime() - created > CHAT_NOTIFY_MAX_AGE_MS) return [];

  const isDm = channel.kind !== "channel";
  const out: ChatNotifyDecision[] = [];
  for (const member of members) {
    if (member.memberId === message.authorMemberId) continue;
    if (member.setting === "nothing") continue;
    // Already read past it (or it predates their membership): nothing to tell them about.
    if (created <= Date.parse(member.readMarker)) continue;

    const mentioned = mentionedMemberIds.has(member.memberId) || (mentionsEveryone && !isDm);
    const level = member.setting === "default" ? (isDm ? "all" : "mentions") : member.setting;
    if (mentioned) {
      out.push({ memberId: member.memberId, kind: isDm ? "chat_dm" : "chat_mention", why: "mentioned", readMarker: member.readMarker });
    } else if (level === "all" && isDm) {
      out.push({ memberId: member.memberId, kind: "chat_dm", why: "a message in their direct conversation", readMarker: member.readMarker });
    } else if (level === "all" && !message.threadRootId) {
      out.push({ memberId: member.memberId, kind: "chat_channel_message", why: "they follow every message in the channel", readMarker: member.readMarker });
    }
  }
  return out;
}

/** Slack mrkdwn treats these three characters as markup; a name or channel title goes into the Slack blocks escaped. */
const escapeSlack = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** The message a decision sends: who and where, a link to the exact conversation (the thread, for a reply), no text of the message. */
export function chatNotificationMessage(
  kind: ChatNotificationKindId,
  { authorName, channelKind, channelName, channelId, threadRootId }: { authorName: string; channelKind: "channel" | "dm" | "group_dm"; channelName: string | null; channelId: string | null; threadRootId: string | null }
): OutboundMessage {
  const where = channelName ? `#${channelName}` : "a channel";
  const text =
    kind === "chat_dm"
      ? channelKind === "group_dm"
        ? `${authorName} sent a message in your group conversation.`
        : `${authorName} sent you a direct message.`
      : kind === "chat_mention"
        ? `${authorName} mentioned you in ${where}.`
        : `New message from ${authorName} in ${where}.`;
  const title = kind === "chat_dm" ? `New message from ${authorName}` : kind === "chat_mention" ? `Mentioned in ${where}` : `New message in ${where}`;
  const url = chatConversationUrl(channelId, threadRootId);
  const linkLabel = kind === "chat_channel_message" ? "Open the channel" : "Open the conversation";
  return {
    title,
    text,
    url,
    linkLabel,
    // The Slack text is escaped (a name can hold & or <); the other channels show the plain text.
    slackBlocks: [{ type: "section", text: { type: "mrkdwn", text: `${escapeSlack(text)}\n<${url}|${linkLabel}>` } }],
    ref: channelId ? chatNotificationRef(channelId) : undefined,
  };
}

export interface ChatNotifyResult {
  /** Members the message was sent to, by the channels it reached. */
  sent: { memberId: string; kind: ChatNotificationKindId; channels: ChannelId[] }[];
  /** Members it would have gone to if the feature were on for them, or that the dry run only logged. */
  dryRun: { memberId: string; kind: ChatNotificationKindId }[];
}

const EMPTY: ChatNotifyResult = { sent: [], dryRun: [] };

/**
 * Considers one stored message and tells the members it is for, on the channels they chose. Never throws (a notification
 * must not fail the webhook or the post); a failure is logged and the nightly pull is not a retry path for this on purpose:
 * a late notification for an old message is worse than none. `repos` must be built on a service-role client.
 */
export async function notifyChatMessage(repos: Repos, messageId: string): Promise<ChatNotifyResult> {
  try {
    return await notifyChatMessageUnsafe(repos, messageId);
  } catch (error) {
    console.error("[chat-notifications] failed for message %s:", messageId, error instanceof Error ? error.message : error);
    return EMPTY;
  }
}

/** The same, for a message known by its Slack channel and ts (what the webhook and the DM pull have). */
export async function notifyChatMessageBySlackTs(repos: Repos, slackChannelId: string, slackTs: string): Promise<ChatNotifyResult> {
  try {
    const channelId = await repos.chat.idBySlackChannel(slackChannelId);
    const messageId = channelId ? await repos.chat.messageIdBySlackTs(channelId, slackTs) : null;
    return messageId ? await notifyChatMessageUnsafe(repos, messageId) : EMPTY;
  } catch (error) {
    console.error("[chat-notifications] failed for Slack message %s/%s:", slackChannelId, slackTs, error instanceof Error ? error.message : error);
    return EMPTY;
  }
}

/** At most this many of a pull's newest messages are considered: a burst of more is one notification anyway. */
const PULLED_MESSAGE_LIMIT = 10;

/**
 * Messages a member's DM pull just stored (Slack ts values): the ones young enough to be a conversation in progress, newest
 * first, are considered like any other new message. A first or catch-up pull of old history costs no query at all.
 */
export async function notifyPulledMessages(repos: Repos, slackChannelId: string, slackTimestamps: string[]): Promise<void> {
  const cutoff = (clock.now() - CHAT_NOTIFY_MAX_AGE_MS) / 1000;
  const recent = slackTimestamps.filter((ts) => Number(ts) >= cutoff).sort().reverse().slice(0, PULLED_MESSAGE_LIMIT);
  await Promise.all(recent.map((ts) => notifyChatMessageBySlackTs(repos, slackChannelId, ts)));
}

async function notifyChatMessageUnsafe(repos: Repos, messageId: string): Promise<ChatNotifyResult> {
  const context = await repos.chat.notificationContext(messageId);
  if (!context) return EMPTY;
  const { message, channel } = context;
  // Cheap exits before any member is loaded.
  if (message.systemSubtype || message.deletedAt || channel.archivedAt) return EMPTY;
  if (clock.now() - Date.parse(message.createdAt) > CHAT_NOTIFY_MAX_AGE_MS) return EMPTY;

  const isDm = channel.kind !== "channel";
  const slackIds = mentionedUserIds(message.body);
  const mentionedMemberIds = new Set(slackIds.length > 0 ? (await repos.chat.memberIdsBySlackUser(slackIds)).values() : []);
  const mentionsEveryone = !isDm && EVERYONE_MENTION.test(message.body);

  // A direct message goes to everyone in it; a channel only to who follows every message or is named, so a busy public
  // channel does not load its whole roster for each message.
  const members = await repos.chat.notifiableMembers(channel.id, { everyone: isDm || mentionsEveryone, memberIds: [...mentionedMemberIds] });
  const decisions = decideChatNotifications({ context, members, mentionedMemberIds, mentionsEveryone, now: new Date(clock.now()) });
  if (decisions.length === 0) return EMPTY;

  const recipientIds = decisions.map((d) => d.memberId);
  const [live, authors] = await Promise.all([
    membersWithFeature(repos, "chat_notifications", recipientIds),
    message.authorMemberId ? repos.members.byIds([message.authorMemberId]) : Promise.resolve([]),
  ]);
  const authorName = authors[0] ? getMemberDisplayName({ name: authors[0].name, display_name: authors[0].displayName }) : "Someone";

  const result: ChatNotifyResult = { sent: [], dryRun: [] };
  const byKind = new Map<ChatNotificationKindId, ChatNotifyDecision[]>();
  for (const decision of decisions) byKind.set(decision.kind, [...(byKind.get(decision.kind) ?? []), decision]);

  await Promise.all(
    [...byKind].map(async ([kind, forKind]) => {
      const outgoing = chatNotificationMessage(kind, {
        authorName,
        channelKind: channel.kind,
        channelName: channel.name,
        channelId: channel.id,
        threadRootId: message.threadRootId,
      });
      const notifier = await createNotifier(repos, kind, forKind.map((d) => d.memberId));
      const claimed = await Promise.all(
        forKind.map(async (decision) => {
          if (!live.has(decision.memberId)) {
            // Dry run: log what would have gone, claim nothing, so switching it on starts from a clean slate.
            console.info("[chat-notifications] dry run: member %s, %s (%s), channels [%s]: %s", decision.memberId, kind, decision.why, notifier.channelsFor(decision.memberId).join(", "), outgoing.text);
            result.dryRun.push({ memberId: decision.memberId, kind });
            return null;
          }
          // Not reachable on any channel (the member has not turned this on): no claim, so turning it on later still sends.
          if (!notifier.canReach(decision.memberId)) return null;
          const dedupKey = `${channel.id}:${decision.readMarker}`;
          return (await repos.notificationLog.claim({ memberId: decision.memberId }, CHAT_UNREAD_CLAIM_KIND, dedupKey, new Date(clock.now()))) ? { decision, dedupKey } : null;
        })
      );
      await Promise.all(
        claimed.map(async (claim) => {
          if (!claim) return;
          const channels = await notifier.send(claim.decision.memberId, outgoing);
          if (channels.length === 0) {
            // Nothing got through: give the claim back so the next message can try again.
            await repos.notificationLog.release({ memberId: claim.decision.memberId }, CHAT_UNREAD_CLAIM_KIND, claim.dedupKey).catch(() => undefined);
            return;
          }
          result.sent.push({ memberId: claim.decision.memberId, kind, channels });
        })
      );
    })
  );
  return result;
}

/**
 * The member has read (or Slack says they have) the conversation: mark its in-app notifications read. Best effort, never
 * thrown: the read itself is already saved.
 */
export async function resolveChatNotifications(repos: Repos, memberId: string, channelId: string): Promise<void> {
  try {
    await repos.notifications.resolveInAppByRef(memberId, chatNotificationRef(channelId));
  } catch (error) {
    console.error("[chat-notifications] resolving member %s conversation %s failed:", memberId, channelId, error instanceof Error ? error.message : error);
  }
}
