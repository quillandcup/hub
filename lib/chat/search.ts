import type { SupabaseClient } from "@supabase/supabase-js";
import { buildMessageViews, type MessageRow, type ChannelSummary, type ChatMessages, type ChatMessageView } from "@/lib/chat/load";

export const SEARCH_PAGE_SIZE = 20;
export const MAX_QUERY_LENGTH = 200;

export interface SearchFilters {
  /** to_tsquery expression from parseSearch; empty for a filters-only search. */
  tsquery: string;
  /** Conversations to search: already scoped to what the member's chat lists. */
  channels: ChannelSummary[];
  /** Name typed in the "From" box or `from:`; matched against the member directory. */
  author?: string;
  /** Exact author (`from:me`); wins over `author`. */
  authorMemberId?: string;
  from?: string | null;
  /** Exclusive upper bound. */
  to?: string | null;
  hasFiles?: boolean;
  inThread?: boolean;
  hasLink?: boolean;
  hasReaction?: boolean;
  page?: number;
}

export interface SearchResult {
  channel: ChannelSummary;
  /** The thread to open to see it in context: its own root for a reply, itself for a top-level message. */
  threadId: string;
  message: ChatMessageView;
}

export interface SearchPage {
  results: SearchResult[];
  hasMore: boolean;
  /** Slack user id -> name and custom emoji for rendering the message texts. */
  render: Pick<ChatMessages, "userNames" | "customEmoji">;
}

const EMPTY: SearchPage = { results: [], hasMore: false, render: { userNames: {}, customEmoji: {} } };

/** Members whose name contains what was typed (LIKE wildcards escaped), for the "From" filter. */
async function authorIds(supabase: SupabaseClient, typed: string): Promise<string[]> {
  const like = `"%${typed.replace(/[\\%_,()"]/g, " ").trim()}%"`;
  const { data } = await supabase.from("member_directory").select("id").or(`name.ilike.${like},display_name.ilike.${like}`).limit(50);
  return (data ?? []).map((m) => m.id as string);
}

/**
 * Full-text search over the messages the caller can read. The search itself runs as the caller
 * (`search_chat_messages`), so RLS drops deleted messages and content they can't read; `channels`
 * is the further scope of the member's own chat.
 */
export async function searchChat(supabase: SupabaseClient, viewerMemberId: string, f: SearchFilters): Promise<SearchPage> {
  if (f.channels.length === 0) return EMPTY;

  let authors: string[] | null = f.authorMemberId ? [f.authorMemberId] : null;
  if (!authors && f.author?.trim()) {
    authors = await authorIds(supabase, f.author);
    if (authors.length === 0) return EMPTY;
  }

  const page = Math.max(0, f.page ?? 0);
  const { data: hits, error } = await supabase.rpc("search_chat_messages", {
    p_query: f.tsquery,
    p_channel_ids: f.channels.map((c) => c.id),
    p_author_member_ids: authors,
    p_from: f.from ?? null,
    p_to: f.to ?? null,
    p_has_files: f.hasFiles ? true : null,
    p_in_thread: f.inThread ? true : null,
    p_has_link: f.hasLink ? true : null,
    p_has_reaction: f.hasReaction ? true : null,
    p_limit: SEARCH_PAGE_SIZE + 1,
    p_offset: page * SEARCH_PAGE_SIZE,
  });
  if (error) {
    console.error("chat search failed", error);
    throw new Error("Chat search failed");
  }
  const ids = ((hits ?? []) as { message_id: string }[]).map((h) => h.message_id);
  const hasMore = ids.length > SEARCH_PAGE_SIZE;
  const pageIds = ids.slice(0, SEARCH_PAGE_SIZE);
  if (pageIds.length === 0) return EMPTY;

  const { data: rows } = await supabase
    .from("chat_messages")
    .select(
      "id, channel_id, thread_root_id, author_member_id, slack_ts, created_at, edited_at, deleted_at, reply_count, last_reply_at, has_files, chat_message_contents(body)"
    )
    .in("id", pageIds);
  type Row = NonNullable<typeof rows>[number];
  const byId = new Map<string, Row>((rows ?? []).map((r) => [r.id as string, r]));
  const channelById = new Map(f.channels.map((c) => [c.id, c]));

  // Views are built per channel (Slack author lookups are keyed by the Slack channel).
  const viewById = new Map<string, ChatMessageView>();
  const render: SearchPage["render"] = { userNames: {}, customEmoji: {} };
  const byChannel = new Map<string, Row[]>();
  for (const r of byId.values()) byChannel.set(r.channel_id, [...(byChannel.get(r.channel_id) ?? []), r]);
  await Promise.all(
    [...byChannel].map(async ([channelId, channelRows]) => {
      const channel = channelById.get(channelId);
      if (!channel) return;
      const built = await buildMessageViews(supabase, channel, channelRows as MessageRow[], viewerMemberId);
      channelRows.forEach((r, i) => viewById.set(r.id, built.views[i]));
      Object.assign(render.userNames, built.userNames);
      Object.assign(render.customEmoji, built.customEmoji);
    })
  );

  const results: SearchResult[] = [];
  for (const id of pageIds) {
    const row = byId.get(id);
    const channel = row ? channelById.get(row.channel_id) : undefined;
    const message = viewById.get(id);
    if (row && channel && message) results.push({ channel, threadId: row.thread_root_id ?? row.id, message });
  }
  return { results, hasMore, render };
}

