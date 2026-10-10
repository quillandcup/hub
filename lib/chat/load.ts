import type { SupabaseClient } from "@supabase/supabase-js";
import { emojiNamesIn, mentionedUserIds } from "@/lib/chat/render";
import { customEmojiFor, slackAuthorIdsByTs, slackUserNames } from "@/lib/chat/names";
import type { CustomEmoji } from "@/lib/chat/emoji";

/**
 * What the chat pages read. Everything goes through the caller's own Supabase client, so RLS
 * (chat_can_see_channel / chat_can_read_content) decides what comes back; the scoping here is
 * on top of that, for what a *member's* chat should list: public channels plus the
 * conversations they are in, even for an admin whose RLS would show more.
 */

export const MESSAGE_PAGE_SIZE = 40;
const THREAD_LIMIT = 500;

export interface ChannelSummary {
  id: string;
  kind: "channel" | "dm" | "group_dm";
  /** "#name" for channels, the other participants for group DMs. */
  label: string;
  visibility: "public" | "private";
  restricted: boolean;
  archived: boolean;
  joined: boolean;
  slackChannelId: string | null;
}

interface ChannelRow {
  id: string;
  kind: ChannelSummary["kind"];
  visibility: ChannelSummary["visibility"];
  restricted: boolean;
  name: string | null;
  archived_at: string | null;
  slack_channel_id: string | null;
}

const CHANNEL_COLUMNS = "id, kind, visibility, restricted, name, archived_at, slack_channel_id";

export async function loadChatChannels(
  supabase: SupabaseClient,
  memberId: string,
  isSudo: boolean
): Promise<ChannelSummary[]> {
  const [{ data: memberships }, { data: channels }] = await Promise.all([
    supabase.from("chat_channel_members").select("channel_id").eq("member_id", memberId).is("left_at", null),
    supabase.from("chat_channels").select(CHANNEL_COLUMNS).order("name"),
  ]);
  const joined = new Set((memberships ?? []).map((m) => m.channel_id as string));

  // Direct messages and group DMs are hidden in sudo (like a member's private notes).
  const visible = ((channels ?? []) as ChannelRow[]).filter(
    (c) => (c.visibility === "public" || joined.has(c.id)) && !(isSudo && c.kind !== "channel")
  );

  const dmLabels = await groupDmLabels(
    supabase,
    visible.filter((c) => c.kind !== "channel").map((c) => c.id),
    memberId
  );

  const summaries = visible.map(
    (c): ChannelSummary => ({
      id: c.id,
      kind: c.kind,
      label: c.kind === "channel" ? `#${c.name ?? "unnamed"}` : (dmLabels.get(c.id) ?? "Group message"),
      visibility: c.visibility,
      restricted: c.restricted,
      archived: c.archived_at !== null,
      joined: joined.has(c.id),
      slackChannelId: c.slack_channel_id,
    })
  );
  const rank = (c: ChannelSummary) => (c.archived ? 2 : c.kind === "channel" ? 0 : 1);
  return summaries.sort((a, b) => rank(a) - rank(b) || a.label.localeCompare(b.label));
}

/** "Fern, Gale" for each group DM: the other people in it. */
async function groupDmLabels(supabase: SupabaseClient, channelIds: string[], memberId: string) {
  const labels = new Map<string, string>();
  if (channelIds.length === 0) return labels;
  const { data: rows } = await supabase
    .from("chat_channel_members")
    .select("channel_id, member_id")
    .in("channel_id", channelIds)
    .is("left_at", null);
  const others = (rows ?? []).filter((r) => r.member_id !== memberId);
  const names = await memberNames(supabase, others.map((r) => r.member_id as string));
  for (const channelId of channelIds) {
    const list = others
      .filter((r) => r.channel_id === channelId)
      .map((r) => names.get(r.member_id as string))
      .filter((n): n is string => Boolean(n));
    if (list.length > 0) labels.set(channelId, list.join(", "));
  }
  return labels;
}

/** Display names from member_directory, which every signed-in member can read. */
export async function memberNames(supabase: SupabaseClient, memberIds: string[]): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  const ids = [...new Set(memberIds)];
  for (let i = 0; i < ids.length; i += 200) {
    const { data } = await supabase.from("member_directory").select("id, name, display_name").in("id", ids.slice(i, i + 200));
    for (const m of data ?? []) names.set(m.id, m.display_name || m.name);
  }
  return names;
}

/**
 * One conversation for the member, or null when they have no business in it: not found under
 * RLS, a private conversation they are not in (admins included: staff reading others' private
 * conversations is not what the member chat is for), or a DM while viewing as a member.
 */
export async function loadChannelForMember(
  supabase: SupabaseClient,
  channelId: string,
  memberId: string,
  isSudo: boolean
): Promise<ChannelSummary | null> {
  const { data: row } = await supabase.from("chat_channels").select(CHANNEL_COLUMNS).eq("id", channelId).maybeSingle();
  if (!row) return null;
  const channel = row as ChannelRow;
  if (isSudo && channel.kind !== "channel") return null;

  const { data: membership } = await supabase
    .from("chat_channel_members")
    .select("channel_id")
    .eq("channel_id", channelId)
    .eq("member_id", memberId)
    .is("left_at", null)
    .maybeSingle();
  if (channel.visibility === "private" && !membership) return null;

  const labels = channel.kind === "channel" ? new Map<string, string>() : await groupDmLabels(supabase, [channel.id], memberId);
  return {
    id: channel.id,
    kind: channel.kind,
    label: channel.kind === "channel" ? `#${channel.name ?? "unnamed"}` : (labels.get(channel.id) ?? "Group message"),
    visibility: channel.visibility,
    restricted: channel.restricted,
    archived: channel.archived_at !== null,
    joined: Boolean(membership),
    slackChannelId: channel.slack_channel_id,
  };
}

interface MessageRow {
  id: string;
  author_member_id: string | null;
  slack_ts: string | null;
  created_at: string;
  edited_at: string | null;
  deleted_at: string | null;
  reply_count: number;
  last_reply_at: string | null;
  has_files: boolean;
  chat_message_contents: { body: string } | { body: string }[] | null;
}

const MESSAGE_COLUMNS =
  "id, author_member_id, slack_ts, created_at, edited_at, deleted_at, reply_count, last_reply_at, has_files, chat_message_contents(body)";

export interface MessagePage {
  /** Oldest first. */
  messages: MessageRow[];
  /** created_at to pass as ?before= for the page of older messages, when there is one. */
  olderBefore: string | null;
}

/** Top-level messages, newest page first, or one thread's replies in order. */
export async function loadMessages(
  supabase: SupabaseClient,
  channelId: string,
  opts: { before?: string | null; threadRootId?: string | null } = {}
): Promise<MessagePage> {
  if (opts.threadRootId) {
    const { data } = await supabase
      .from("chat_messages")
      .select(MESSAGE_COLUMNS)
      .eq("channel_id", channelId)
      .eq("thread_root_id", opts.threadRootId)
      .order("created_at", { ascending: true })
      .limit(THREAD_LIMIT);
    return { messages: (data ?? []) as MessageRow[], olderBefore: null };
  }

  let query = supabase.from("chat_messages").select(MESSAGE_COLUMNS).eq("channel_id", channelId).is("thread_root_id", null);
  if (opts.before) query = query.lt("created_at", opts.before);
  const { data } = await query.order("created_at", { ascending: false }).limit(MESSAGE_PAGE_SIZE + 1);
  const rows = (data ?? []) as MessageRow[];
  const hasOlder = rows.length > MESSAGE_PAGE_SIZE;
  const page = rows.slice(0, MESSAGE_PAGE_SIZE).reverse();
  return { messages: page, olderBefore: hasOlder && page.length > 0 ? page[0].created_at : null };
}

/** One message by id (a thread's root), under RLS. */
export async function loadMessage(supabase: SupabaseClient, channelId: string, messageId: string): Promise<MessageRow | null> {
  const { data } = await supabase
    .from("chat_messages")
    .select(MESSAGE_COLUMNS)
    .eq("channel_id", channelId)
    .eq("id", messageId)
    .maybeSingle();
  return (data as MessageRow | null) ?? null;
}

export interface ReactionSummary {
  emoji: string;
  count: number;
  mine: boolean;
}

export type ContentState = "ok" | "deleted" | "hidden";

export interface ChatMessageView {
  id: string;
  authorName: string;
  createdAt: string;
  editedAt: string | null;
  /** Text to render, or null when the content isn't shown (see contentState). */
  body: string | null;
  /** "deleted" = removed in Slack (a tombstone); "hidden" = this viewer can't read it. */
  contentState: ContentState;
  hasFiles: boolean;
  replyCount: number;
  lastReplyAt: string | null;
  reactions: ReactionSummary[];
}

export interface ChatMessages {
  views: ChatMessageView[];
  /** Slack user id -> name, for <@U123> mentions in the bodies. */
  userNames: Record<string, string>;
  /** Custom emoji used in the bodies and reactions, by shortcode. */
  customEmoji: Record<string, CustomEmoji>;
}

const bodyOf = (row: MessageRow): string | null => {
  const c = Array.isArray(row.chat_message_contents) ? row.chat_message_contents[0] : row.chat_message_contents;
  return c?.body ?? null;
};

/** Messages with their authors' names, reactions and body state, ready to render. */
export async function buildMessageViews(
  supabase: SupabaseClient,
  channel: Pick<ChannelSummary, "slackChannelId">,
  rows: MessageRow[],
  viewerMemberId: string
): Promise<ChatMessages> {
  if (rows.length === 0) return { views: [], userNames: {}, customEmoji: {} };

  const matched = rows.filter((r) => r.author_member_id).map((r) => r.author_member_id as string);
  const unmatched = rows.filter((r) => !r.author_member_id && r.slack_ts).map((r) => r.slack_ts as string);

  const [names, slackAuthorByTs, { data: reactionRows }] = await Promise.all([
    memberNames(supabase, matched),
    channel.slackChannelId && unmatched.length > 0
      ? slackAuthorIdsByTs(channel.slackChannelId, unmatched)
      : Promise.resolve({} as Record<string, string>),
    supabase
      .from("chat_reactions")
      .select("message_id, emoji, member_id")
      .in("message_id", rows.map((r) => r.id))
      .is("deleted_at", null),
  ]);

  // One batch for every Slack name needed: unmatched authors plus people mentioned in the text.
  const mentioned = rows.flatMap((r) => mentionedUserIds(bodyOf(r) ?? ""));
  const emojiNames = [
    ...rows.flatMap((r) => emojiNamesIn(bodyOf(r) ?? "")),
    ...(reactionRows ?? []).map((r) => String(r.emoji).replace(/::skin-tone-\d$/, "").toLowerCase()),
  ];
  const [userNames, customEmoji] = await Promise.all([
    slackUserNames([...Object.values(slackAuthorByTs), ...mentioned]),
    customEmojiFor(emojiNames),
  ]);

  const reactionsByMessage = new Map<string, Map<string, ReactionSummary>>();
  for (const r of reactionRows ?? []) {
    const byEmoji = reactionsByMessage.get(r.message_id) ?? new Map<string, ReactionSummary>();
    const entry = byEmoji.get(r.emoji) ?? { emoji: r.emoji as string, count: 0, mine: false };
    entry.count++;
    if (r.member_id === viewerMemberId) entry.mine = true;
    byEmoji.set(r.emoji, entry);
    reactionsByMessage.set(r.message_id, byEmoji);
  }

  const views = rows.map((row): ChatMessageView => {
    const body = bodyOf(row);
    const contentState: ContentState = row.deleted_at ? "deleted" : body === null ? "hidden" : "ok";
    const slackUserId = row.slack_ts ? slackAuthorByTs[row.slack_ts] : undefined;
    return {
      id: row.id,
      authorName:
        (row.author_member_id ? names.get(row.author_member_id) : undefined) ??
        (slackUserId ? userNames[slackUserId] : undefined) ??
        (slackUserId?.startsWith("B") ? "Slack app" : "Someone on Slack"),
      createdAt: row.created_at,
      editedAt: row.edited_at,
      body: contentState === "ok" ? body : null,
      contentState,
      hasFiles: row.has_files,
      replyCount: row.reply_count,
      lastReplyAt: row.last_reply_at,
      reactions: [...(reactionsByMessage.get(row.id)?.values() ?? [])].sort((a, b) => b.count - a.count),
    };
  });
  return { views, userNames, customEmoji };
}
