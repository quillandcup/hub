import type { StageTimer } from "@/lib/chat/timing";
import type { SupabaseClient } from "@supabase/supabase-js";
import { emojiNamesIn, mentionedChannelIds, mentionedUserIds } from "@/lib/chat/render";
import { customEmojiFor, slackAuthorIdsByTs, slackChannelNames, slackUserHubNames, slackUserMemberIds, slackUserNames, slackUserPhotos } from "@/lib/chat/names";
import type { CustomEmoji } from "@/lib/chat/emoji";
import type { ChatTextContext } from "@/components/chat/ChatText";
import { safeUrl } from "@/lib/url";
import { parseChatFiles, type ChatFile } from "@/lib/chat/files";
import { getAttendedPrickleCount, getMemberBadges, type EarnedBadge } from "@/lib/badges";
import { createRepos } from "@/lib/data/repos";
import type { ChannelRecord } from "@/lib/data/chat";

/**
 * What the chat pages read. Everything goes through the caller's own Supabase client, so RLS
 * (chat_can_see_channel / chat_can_read_content) decides what comes back; the scoping here is
 * on top of that, for what a *member's* chat should list: public channels plus the
 * conversations they are in, even for an admin whose RLS would show more.
 */

export const MESSAGE_PAGE_SIZE = 40;
const THREAD_LIMIT = 500;
const REPLY_AVATARS = 5;
/** Distinct repliers read per thread before Slack-only ones are merged by user, so a duplicate does not eat a slot. */
const REPLY_CANDIDATES = 25;

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


export async function loadChatChannels(
  supabase: SupabaseClient,
  memberId: string,
  isSudo: boolean,
  timer?: StageTimer
): Promise<ChannelSummary[]> {
  const t = <T,>(name: string, work: PromiseLike<T>): PromiseLike<T> => (timer ? timer.time(name, work) : work);
  const chat = createRepos(supabase).chat;
  // A failed read lists nothing, as it always has.
  const [joined, channels] = await Promise.all([
    t("memberships", chat.joinedChannelIds(memberId).catch(() => new Set<string>())),
    t("channels", chat.listChannels().catch((): ChannelRecord[] => [])),
  ]);
  timer?.mark("stage1");

  // Direct messages and group DMs are hidden in sudo (like a member's private notes).
  const visible = channels.filter(
    (c) => (c.visibility === "public" || joined.has(c.id)) && !(isSudo && c.kind !== "channel")
  );

  const dmIds = visible.filter((c) => c.kind !== "channel").map((c) => c.id);
  timer?.note("visible", visible.length);
  timer?.note("dms", dmIds.length);
  const dmLabels = await groupDmLabels(supabase, dmIds, memberId, timer);
  timer?.mark("dmLabels");

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
async function groupDmLabels(supabase: SupabaseClient, channelIds: string[], memberId: string, timer?: StageTimer) {
  const labels = new Map<string, string>();
  if (channelIds.length === 0) return labels;
  const rows = await createRepos(supabase).chat.activeMembersOf(channelIds).catch(() => []);
  timer?.mark("dmMembers");
  const others = rows.filter((r) => r.member_id !== memberId);
  timer?.note("dmPeople", others.length);
  const names = await memberProfiles(supabase, others.map((r) => r.member_id as string));
  for (const channelId of channelIds) {
    const list = others
      .filter((r) => r.channel_id === channelId)
      .map((r) => names.get(r.member_id as string)?.name)
      .filter((n): n is string => Boolean(n));
    if (list.length > 0) labels.set(channelId, list.join(", "));
  }
  return labels;
}

/** Unread top-level messages per conversation the signed-in member is in (capped at 100 each; none = absent). */
export async function loadUnreadCounts(supabase: SupabaseClient): Promise<Record<string, number>> {
  const { data } = await supabase.rpc("chat_unread_counts");
  const counts: Record<string, number> = {};
  for (const row of (data ?? []) as { channel_id: string; unread: number }[]) counts[row.channel_id] = row.unread;
  return counts;
}

/** Display names and photos from member_directory, which every signed-in member can read. */
export async function memberProfiles(
  supabase: SupabaseClient,
  memberIds: string[]
): Promise<Map<string, { name: string; photoUrl: string | null }>> {
  const profiles = new Map<string, { name: string; photoUrl: string | null }>();
  for (const m of await createRepos(supabase).directory.byIds(memberIds)) {
    profiles.set(m.id, { name: m.display_name || m.name, photoUrl: safeUrl(m.photo_url) });
  }
  return profiles;
}

/** What the profile panel in chat shows about a member: the public parts of their profile. */
export interface MemberCard {
  id: string;
  name: string;
  photoUrl: string | null;
  bio: string | null;
  /** Month the member first joined, as a date (YYYY-MM-DD), when they have been a paying member. */
  firstJoinedAt: string | null;
  totalActiveMonths: number;
  askMeAbout: string[];
  instagramUrl: string | null;
  facebookUrl: string | null;
  twitterUrl: string | null;
  /** The badges the full profile shows, computed the same way. */
  badges: EarnedBadge[];
}

/** One member's card from member_directory and their "Ask me about…" topics (both readable by any member). */
export async function loadMemberCard(supabase: SupabaseClient, memberId: string): Promise<MemberCard | null> {
  const [m, topics] = await Promise.all([
    createRepos(supabase).directory.byId(memberId),
    createRepos(supabase).memberProfile.askMeAbout(memberId),
  ]);
  if (!m) return null;
  const badges = await getMemberBadges(supabase, memberId, await getAttendedPrickleCount(createRepos(supabase).attendance, memberId), m.first_joined_at ?? null);
  return {
    id: m.id,
    name: m.display_name || m.name,
    photoUrl: safeUrl(m.photo_url),
    bio: m.bio || null,
    firstJoinedAt: m.first_joined_at ?? null,
    totalActiveMonths: m.total_active_months ?? 0,
    askMeAbout: topics,
    instagramUrl: safeUrl(m.instagram_url),
    facebookUrl: safeUrl(m.facebook_url),
    twitterUrl: safeUrl(m.twitter_url),
    badges,
  };
}

export interface ChannelPerson {
  memberId: string;
  name: string;
  photoUrl: string | null;
}

/** Who is in a conversation now (matched members only, A to Z), under RLS. Paged past the 1000-row cap. */
export async function loadChannelMembers(supabase: SupabaseClient, channelId: string): Promise<ChannelPerson[]> {
  // A failed read lists nobody, as it always has.
  const memberIds = await createRepos(supabase).chat.activeMembersOf([channelId]).then((rows) => rows.map((r) => r.member_id)).catch(() => []);
  const profiles = await memberProfiles(supabase, memberIds);
  return memberIds
    .flatMap((memberId) => {
      const p = profiles.get(memberId);
      return p ? [{ memberId, name: p.name, photoUrl: p.photoUrl }] : [];
    })
    .sort((a, b) => a.name.localeCompare(b.name));
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
  // The channel and the member's place in it don't depend on each other, so read them together.
  // (A failed read of either is "not there", as it always has been.)
  const chat = createRepos(supabase).chat;
  const [channel, membership] = await Promise.all([
    chat.channelRecord(channelId).catch(() => null),
    chat.activeMembership(channelId, memberId).then((m) => m !== null).catch(() => false),
  ]);
  if (!channel) return null;
  if (isSudo && channel.kind !== "channel") return null;
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

export interface MessageRow {
  id: string;
  author_member_id: string | null;
  slack_ts: string | null;
  /** 'app' for a message written in the Hub, 'slack' for one projected from Slack. */
  origin?: "app" | "slack";
  created_at: string;
  edited_at: string | null;
  deleted_at: string | null;
  reply_count: number;
  last_reply_at: string | null;
  has_files: boolean;
  /** The Slack subtype of a notice Slack posted itself (a channel rename, say); null for a message someone wrote. */
  system_subtype?: string | null;
  /** The outbox state of a message written in the Hub; null for Slack-origin rows. */
  slack_sync_status?: "pending" | "sent" | "failed" | null;
  chat_message_contents: { body: string; files?: unknown } | { body: string; files?: unknown }[] | null;
}

/** The message reads here have always shown an empty list rather than an error page when the database fails: keep that. */
export const ignoringErrors = <T,>(rows: Promise<T[]>): Promise<T[]> => rows.catch(() => []);

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
  const { chat } = createRepos(supabase);
  if (opts.threadRootId) {
    return { messages: await ignoringErrors(chat.threadMessages(channelId, opts.threadRootId, THREAD_LIMIT)), olderBefore: null };
  }

  const rows = await ignoringErrors(chat.channelMessages(channelId, { before: opts.before, limit: MESSAGE_PAGE_SIZE + 1 }));
  const hasOlder = rows.length > MESSAGE_PAGE_SIZE;
  const page = rows.slice(0, MESSAGE_PAGE_SIZE).reverse();
  return { messages: page, olderBefore: hasOlder && page.length > 0 ? page[0].created_at : null };
}

/**
 * Specific top-level messages of a conversation by id, under RLS: to bring messages that changed
 * (a reaction) up to date wherever they are in the list. Replies are left out (the thread has its own).
 */
export async function loadMessagesByIds(supabase: SupabaseClient, channelId: string, ids: string[]): Promise<MessageRow[]> {
  if (ids.length === 0) return [];
  return ignoringErrors(createRepos(supabase).chat.topLevelMessagesByIds(channelId, ids));
}

/** One message by id (a thread's root), under RLS. */
export async function loadMessage(supabase: SupabaseClient, channelId: string, messageId: string): Promise<MessageRow | null> {
  return createRepos(supabase).chat.messageById(channelId, messageId).catch(() => null);
}

export interface ReactionSummary {
  emoji: string;
  count: number;
  mine: boolean;
  /** Names of the other people who reacted (the viewer is `mine`, not listed); may be fewer than count - 1 for unnamed Slack people. */
  reactors?: string[];
}

export type ContentState = "ok" | "deleted" | "hidden";

export interface Person {
  name: string;
  photoUrl: string | null;
}

export interface ChatMessageView {
  id: string;
  /** The author's Hub member, for linking to their profile; null for Slack people we haven't matched. */
  authorMemberId: string | null;
  authorName: string;
  authorPhotoUrl: string | null;
  /** Up to REPLY_AVATARS distinct people who replied in the thread, earliest first. */
  replyAuthors: Person[];
  createdAt: string;
  editedAt: string | null;
  /** Text to render, or null when the content isn't shown (see contentState). */
  body: string | null;
  /** "deleted" = removed in Slack (a tombstone); "hidden" = this viewer can't read it. */
  contentState: ContentState;
  hasFiles: boolean;
  /** The files to show under the message (empty when it has none, or Slack never gave us any). */
  files: ChatFile[];
  replyCount: number;
  lastReplyAt: string | null;
  reactions: ReactionSummary[];
  /** A message written in the Hub that Slack hasn't taken yet: "pending" (sending) or "failed". Null once it is in Slack. */
  syncStatus: "pending" | "failed" | null;
  /** Written by the viewer (the member whose chat this is), who may retry it when it failed. */
  mine: boolean;
  /** Written in the Hub (not projected from Slack): the only kind its author can edit or delete from here. */
  fromHub: boolean;
  /** A notice Slack posted itself ("… renamed the channel"): shown as a quiet line, not a post. */
  system: boolean;
}

export interface ChatMessages {
  views: ChatMessageView[];
  /** Slack user id -> name, for <@U123> mentions in the bodies. */
  userNames: Record<string, string>;
  /** Slack user id -> Hub member id for matched people, so mentions can link to a profile. */
  userMembers: Record<string, string>;
  /** Slack user id -> Hub name, for the people named in notices (joins, leaves, renames). */
  hubNames?: Record<string, string>;
  /** Slack channel id -> name for <#C123> links in the bodies (public channels). */
  channelNames: Record<string, string>;
  /** Custom emoji used in the bodies and reactions, by shortcode. */
  customEmoji: Record<string, CustomEmoji>;
}

/** What ChatText needs to render a page's messages: names, profile links and channel links. */
export function chatTextContext(rendered: Omit<ChatMessages, "views">, channels: ChannelSummary[]): ChatTextContext {
  return {
    userNames: rendered.userNames,
    userMembers: rendered.userMembers,
    hubNames: rendered.hubNames,
    customEmoji: rendered.customEmoji,
    // Names of channels the member is in (private ones included) win over the public-name lookup.
    channelNames: {
      ...rendered.channelNames,
      ...Object.fromEntries(channels.filter((c) => c.slackChannelId && c.kind === "channel").map((c) => [c.slackChannelId as string, c.label.replace(/^#/, "")])),
    },
    channelIds: Object.fromEntries(channels.filter((c) => c.slackChannelId).map((c) => [c.slackChannelId as string, c.id])),
  };
}

const contentOf = (row: MessageRow) =>
  Array.isArray(row.chat_message_contents) ? row.chat_message_contents[0] : row.chat_message_contents;

const bodyOf = (row: MessageRow): string | null => contentOf(row)?.body ?? null;

interface ReplyAuthor {
  memberId: string | null;
  slackTs: string | null;
}

/**
 * For each thread root, the first few people who replied (earliest first), for the avatar
 * stack. Members are distinct; Slack-only people are by message, and merged by user later. Reads the whole reply set page by page, since a busy channel can pass the
 * 1000-row cap, and skips deleted replies.
 */
async function loadReplyAuthors(supabase: SupabaseClient, rootIds: string[]): Promise<Map<string, ReplyAuthor[]>> {
  const out = new Map<string, ReplyAuthor[]>();
  if (rootIds.length === 0) return out;
  const seen = new Map<string, Set<string>>();
  for (const r of await ignoringErrors(createRepos(supabase).chat.replyAuthorRows(rootIds))) {
    const list = out.get(r.thread_root_id) ?? [];
    const ids = seen.get(r.thread_root_id) ?? new Set<string>();
    // A Slack-only replier is keyed by message ts here; their user id is looked up afterwards.
    const key = r.author_member_id ?? `ts:${r.slack_ts}`;
    if (list.length < REPLY_CANDIDATES && !ids.has(key)) {
      ids.add(key);
      list.push({ memberId: r.author_member_id, slackTs: r.slack_ts });
      out.set(r.thread_root_id, list);
      seen.set(r.thread_root_id, ids);
    }
  }
  return out;
}

/** Every live reaction on these messages, all pages; a database error is an error, not an empty list (that would read as "everyone took theirs back"). */
export function loadReactionRows(supabase: SupabaseClient, messageIds: string[]) {
  return createRepos(supabase).chat.reactionRows(messageIds);
}

/** Messages with their authors' names, reactions and body state, ready to render. */
export async function buildMessageViews(
  supabase: SupabaseClient,
  channel: Pick<ChannelSummary, "slackChannelId">,
  allRows: MessageRow[],
  viewerMemberId: string,
  timer?: StageTimer
): Promise<ChatMessages> {
  // A deleted message is not shown at all. Exception: a deleted thread root that still has
  // live replies stays as a row with no content (the UI shows a tombstone), so its replies link
  // keeps the thread reachable (reply_count only counts live replies).
  const rows = allRows.filter((r) => !r.deleted_at || r.reply_count > 0);
  if (rows.length === 0) return { views: [], userNames: {}, userMembers: {}, hubNames: {}, channelNames: {}, customEmoji: {} };

  const matched = rows.filter((r) => r.author_member_id).map((r) => r.author_member_id as string);
  const unmatched = rows.filter((r) => !r.author_member_id && r.slack_ts).map((r) => r.slack_ts as string);
  const threadRoots = rows.filter((r) => r.reply_count > 0).map((r) => r.id);

  // Lookups that need only the rows are started with the first batch: mention names, notices,
  // channel links and the emoji used in the bodies. The batches below reuse them.
  const mentioned = rows.flatMap((r) => mentionedUserIds(bodyOf(r) ?? ""));
  // People named in a notice (a join, a leave) are shown by their Hub name; elsewhere a mention reads as in Slack.
  const mentionedInNotices = rows.flatMap((r) => (r.system_subtype ? mentionedUserIds(bodyOf(r) ?? "") : []));
  const bodyEmojiNames = rows.flatMap((r) => emojiNamesIn(bodyOf(r) ?? ""));

  const t = <T,>(name: string, work: PromiseLike<T>): PromiseLike<T> => (timer ? timer.time(name, work) : work);
  timer?.note("rows", rows.length);
  timer?.note("roots", threadRoots.length);
  timer?.note("unmatched", unmatched.length);

  const [profiles, slackAuthorByTs, reactionRows, replies, userMembers, hubNames, channelNames] = await Promise.all([
    t("b1.profiles", memberProfiles(supabase, matched)),
    t(
      "b1.slackAuthors",
      channel.slackChannelId && unmatched.length > 0
        ? slackAuthorIdsByTs(channel.slackChannelId, unmatched)
        : Promise.resolve({} as Record<string, string>)
    ),
    t("b1.reactions", loadReactionRows(supabase, rows.map((r) => r.id))),
    t("b1.replyAuthors", loadReplyAuthors(supabase, threadRoots)),
    t("b1.userMembers", slackUserMemberIds(mentioned)),
    t("b1.hubNames", slackUserHubNames(mentionedInNotices)),
    t("b1.channelNames", slackChannelNames(rows.flatMap((r) => mentionedChannelIds(bodyOf(r) ?? "")))),
  ]);
  timer?.mark("views.batch1");

  const replyList = [...replies.values()].flat();
  const reactorMemberIds = [...new Set((reactionRows ?? []).flatMap((r) => (r.member_id && r.member_id !== viewerMemberId ? [r.member_id as string] : [])))];
  const reactorSlackIds = [...new Set((reactionRows ?? []).flatMap((r) => (!r.member_id && r.slack_user_id ? [r.slack_user_id as string] : [])))];
  const emojiNames = [
    ...bodyEmojiNames,
    ...(reactionRows ?? []).map((r) => String(r.emoji).replace(/::skin-tone-\d$/, "").toLowerCase()),
  ];
  // Repliers with no matched member: who wrote them, by Slack ts.
  const unmatchedReplyTs = replyList.filter((a) => !a.memberId && a.slackTs).map((a) => a.slackTs as string);

  // Two independent chains run together: the repliers' and reactors' Hub profiles (one lookup), and
  // the Slack side (replier authors by ts, then every Slack name, photo and emoji in one batch).
  const [otherProfiles, slackSide] = await Promise.all([
    t("b2.profiles", memberProfiles(supabase, [...replyList.flatMap((a) => (a.memberId ? [a.memberId] : [])), ...reactorMemberIds])),
    (async () => {
      const replySlackAuthors =
        channel.slackChannelId && unmatchedReplyTs.length > 0
          ? await t("b2.replySlackAuthors", slackAuthorIdsByTs(channel.slackChannelId, unmatchedReplyTs))
          : ({} as Record<string, string>);
      const slackIds = [...Object.values(slackAuthorByTs), ...Object.values(replySlackAuthors), ...reactorSlackIds];
      const [userNames, slackPhotos, customEmoji] = await Promise.all([
        t("b2.userNames", slackUserNames([...slackIds, ...mentioned])),
        t("b2.photos", slackUserPhotos(slackIds)),
        t("b2.emoji", customEmojiFor(emojiNames)),
      ]);
      return { replySlackAuthors, userNames, slackPhotos, customEmoji };
    })(),
  ]);
  const replyProfiles = otherProfiles;
  const reactorProfiles = otherProfiles;
  const { replySlackAuthors, userNames, slackPhotos, customEmoji } = slackSide;
  timer?.mark("views.profilesAndNames");

  const slackPerson = (slackUserId: string | undefined): Person => ({
    name: (slackUserId ? userNames[slackUserId] : undefined) ?? (slackUserId?.startsWith("B") ? "Slack app" : "Someone on Slack"),
    photoUrl: (slackUserId ? slackPhotos[slackUserId] : undefined) ?? null,
  });

  const reactionsByMessage = new Map<string, Map<string, ReactionSummary>>();
  // A member who reacted in Slack and again in the Hub with the same emoji counts once.
  const counted = new Set<string>();
  for (const r of reactionRows ?? []) {
    if (r.member_id) {
      const key = `${r.message_id}|${r.emoji}|${r.member_id}`;
      if (counted.has(key)) continue;
      counted.add(key);
    }
    const byEmoji = reactionsByMessage.get(r.message_id) ?? new Map<string, ReactionSummary>();
    const entry = byEmoji.get(r.emoji) ?? { emoji: r.emoji as string, count: 0, mine: false, reactors: [] };
    entry.count++;
    if (r.member_id === viewerMemberId) entry.mine = true;
    else {
      const name = r.member_id ? reactorProfiles.get(r.member_id)?.name : r.slack_user_id ? userNames[r.slack_user_id] : undefined;
      if (name) entry.reactors?.push(name);
    }
    byEmoji.set(r.emoji, entry);
    reactionsByMessage.set(r.message_id, byEmoji);
  }

  const views = rows.map((row): ChatMessageView => {
    const body = bodyOf(row);
    const contentState: ContentState = row.deleted_at ? "deleted" : body === null ? "hidden" : "ok";
    const author =
      (row.author_member_id ? profiles.get(row.author_member_id) : undefined) ??
      slackPerson(row.slack_ts ? slackAuthorByTs[row.slack_ts] : undefined);
    const replyAuthors: Person[] = [];
    const replySeen = new Set<string>();
    for (const a of replies.get(row.id) ?? []) {
      const slackUserId = a.slackTs ? replySlackAuthors[a.slackTs] : undefined;
      const key = a.memberId ? `m:${a.memberId}` : `s:${slackUserId ?? a.slackTs}`;
      if (replySeen.has(key) || replyAuthors.length >= REPLY_AVATARS) continue;
      replySeen.add(key);
      replyAuthors.push((a.memberId ? replyProfiles.get(a.memberId) : undefined) ?? slackPerson(slackUserId));
    }
    return {
      id: row.id,
      authorMemberId: row.author_member_id,
      authorName: author.name,
      authorPhotoUrl: author.photoUrl,
      replyAuthors,
      createdAt: row.created_at,
      editedAt: row.edited_at,
      body: contentState === "ok" ? body : null,
      contentState,
      hasFiles: row.has_files,
      files: contentState === "ok" ? parseChatFiles(contentOf(row)?.files) : [],
      replyCount: row.reply_count,
      lastReplyAt: row.last_reply_at,
      reactions: [...(reactionsByMessage.get(row.id)?.values() ?? [])].sort((a, b) => b.count - a.count),
      syncStatus: row.slack_sync_status === "pending" || row.slack_sync_status === "failed" ? row.slack_sync_status : null,
      mine: row.author_member_id === viewerMemberId,
      fromHub: row.origin === "app",
      system: Boolean(row.system_subtype),
    };
  });
  return { views, userNames, userMembers, hubNames, channelNames, customEmoji };
}
