import type { SupabaseClient } from "@supabase/supabase-js";
import { createRepos } from "@/lib/data/repos";
import { buildMessageViews, ignoringErrors, type MessageRow, type ChannelSummary, type ChatMessages, type ChatMessageView } from "@/lib/chat/load";

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
  render: Omit<ChatMessages, "views">;
}

const EMPTY: SearchPage = { results: [], hasMore: false, render: { userNames: {}, userMembers: {}, channelNames: {}, customEmoji: {} } };

/** Members whose name contains what was typed (LIKE wildcards escaped), for the "From" filter. */
async function authorIds(supabase: SupabaseClient, typed: string): Promise<string[]> {
  return createRepos(supabase).directory.idsMatching(typed, 50);
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
  const { chat } = createRepos(supabase);
  let ids: string[];
  try {
    ids = await chat.searchMessageIds({
      tsquery: f.tsquery,
      channelIds: f.channels.map((c) => c.id),
      authorMemberIds: authors,
      from: f.from ?? null,
      to: f.to ?? null,
      hasFiles: Boolean(f.hasFiles),
      inThread: Boolean(f.inThread),
      hasLink: Boolean(f.hasLink),
      hasReaction: Boolean(f.hasReaction),
      limit: SEARCH_PAGE_SIZE + 1,
      offset: page * SEARCH_PAGE_SIZE,
    });
  } catch (error) {
    console.error("chat search failed", error);
    throw new Error("Chat search failed");
  }
  const hasMore = ids.length > SEARCH_PAGE_SIZE;
  const pageIds = ids.slice(0, SEARCH_PAGE_SIZE);
  if (pageIds.length === 0) return EMPTY;

  const rows = await ignoringErrors(chat.searchMessagesByIds(pageIds));
  type Row = (typeof rows)[number];
  const byId = new Map<string, Row>(rows.map((r) => [r.id, r]));
  const channelById = new Map(f.channels.map((c) => [c.id, c]));

  // Views are built per channel (Slack author lookups are keyed by the Slack channel).
  const viewById = new Map<string, ChatMessageView>();
  const render: SearchPage["render"] = { userNames: {}, userMembers: {}, channelNames: {}, customEmoji: {} };
  const byChannel = new Map<string, Row[]>();
  for (const r of byId.values()) byChannel.set(r.channel_id, [...(byChannel.get(r.channel_id) ?? []), r]);
  await Promise.all(
    [...byChannel].map(async ([channelId, channelRows]) => {
      const channel = channelById.get(channelId);
      if (!channel) return;
      const built = await buildMessageViews(supabase, channel, channelRows as MessageRow[], viewerMemberId);
      channelRows.forEach((r, i) => viewById.set(r.id, built.views[i]));
      Object.assign(render.userNames, built.userNames);
      Object.assign(render.userMembers, built.userMembers);
      Object.assign(render.channelNames, built.channelNames);
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

