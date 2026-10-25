/**
 * Universal search: one function per resource kind, each returning rows shaped for a grouped
 * result list. Every query runs on the caller's own Supabase client, so RLS decides what they
 * can see (never pass the service-role client). Members come from `member_directory`, which has
 * no email or status; only an admin acting as themselves (not in sudo) searches `members` itself.
 * Chat reuses searchChat (full text, via search_chat_messages). Word matching is `ilike` on the
 * few fields each kind shows: these tables are small. A prickle's title is its own only when the host named it; otherwise it is computed.
 */
import { createRepos } from "@/lib/data/repos";
import type { SupabaseClient } from "@supabase/supabase-js";
import { formatPrickleDetailTitle } from "@/lib/formatters";
import { searchChat, SEARCH_PAGE_SIZE } from "@/lib/chat/search";
import { mentionsToPlainText } from "@/lib/chat/render";
import type { ChannelSummary } from "@/lib/chat/load";
import { KIND_LABELS, type KindResults, type SearchHit } from "@/lib/search/kinds";
import type { FeatureKey } from "@/lib/features";
import { getHostVibeTypes } from "@/lib/host-vibes";
import { matchPages } from "@/lib/search/pages";
import { hasCriteria, kindHonors, matchWords, SEARCH_KINDS, type AnySearchKind, type SearchKind, type UniversalQuery } from "@/lib/search/syntax";

export interface SearchContext {
  supabase: SupabaseClient;
  /** The effective member (the sudo'd one when sudo is on); null for an admin with no member record. */
  viewerMemberId: string | null;
  /** An admin acting as themselves: gets email:/status: and admin links. False in sudo. */
  isActingAsAdmin: boolean;
  /**
   * Conversations chat search may look in (what the member's chat lists). A function so the lookup
   * only runs, alongside the other kinds' queries, when chat is actually searched.
   */
  chatChannels: ChannelSummary[] | (() => Promise<ChannelSummary[]>);
  /** Features on for the viewer (and chat, when they have it): hides pages whose feature is off. */
  features?: FeatureKey[];
  /** Rows per kind; one extra is fetched to know if there are more. */
  limit?: number;
  offset?: number;
  /** A searcher's sub-stage milliseconds (e.g. chat_channels), filled in for the caller's metrics. */
  stages?: Record<string, number>;
}

/** One word as a quoted PostgREST ilike pattern, with its wildcards and separators neutralized. */
const pattern = (word: string) => `"%${word.replace(/[\\%_,()"]/g, " ").trim()}%"`;

/** Adds one AND-ed `.or(field ilike word, ...)` per word. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function matchEach<T extends { or: (f: string) => any }>(query: T, words: string[], fields: string[]): T {
  let out = query;
  for (const w of words) out = out.or(fields.map((f) => `${f}.ilike.${pattern(w)}`).join(","));
  return out;
}

/** Directory ids of members whose name contains `typed`; "me" is the viewer. null = no such filter. */
async function memberIdsNamed(ctx: SearchContext, typed: string | undefined): Promise<string[] | null> {
  if (!typed) return null;
  if (typed.toLowerCase() === "me") return ctx.viewerMemberId ? [ctx.viewerMemberId] : [];
  const { data } = await ctx.supabase
    .from("member_directory")
    .select("id")
    .or(`name.ilike.${pattern(typed)},display_name.ilike.${pattern(typed)}`)
    .limit(50);
  return (data ?? []).map((m) => m.id as string);
}

const page = (ctx: SearchContext) => ({ limit: ctx.limit ?? 5, offset: ctx.offset ?? 0 });

function finish<T>(rows: T[] | null, limit: number): { rows: T[]; hasMore: boolean } {
  const all = rows ?? [];
  return { rows: all.slice(0, limit), hasMore: all.length > limit };
}

/** App pages (navigation and settings tabs) by title, section or keyword. */
async function searchPages(ctx: SearchContext, q: UniversalQuery): Promise<KindResults> {
  const { limit, offset } = page(ctx);
  const candidates = matchPages(matchWords(q), { isActingAsAdmin: ctx.isActingAsAdmin, features: ctx.features ?? [], canConfigureHostVibes: true });
  // Only load hosting eligibility when the query would otherwise show these settings.
  const hostingSettings = (href: string) => href.split("#")[0] === "/settings/hosting";
  const canConfigureHostVibes = candidates.some((p) => hostingSettings(p.href)) && ctx.viewerMemberId
    ? (await getHostVibeTypes(ctx.supabase, ctx.viewerMemberId)).size > 0
    : false;
  const rows = candidates.filter((p) => !hostingSettings(p.href) || canConfigureHostVibes);
  return {
    kind: "pages",
    hasMore: rows.length > offset + limit,
    hits: rows.slice(offset, offset + limit).map((p) => ({ kind: "pages", id: `${p.href}|${p.title}`, title: p.title, subtitle: p.section, href: p.href })),
  };
}

/** Channels the member can open in chat, by name (never a group message, whose label is people). */
async function searchChannels(ctx: SearchContext, q: UniversalQuery): Promise<KindResults> {
  const { limit, offset } = page(ctx);
  const all = typeof ctx.chatChannels === "function" ? await ctx.chatChannels() : ctx.chatChannels;
  const words = matchWords(q).map((w) => w.toLowerCase());
  const rank = (c: ChannelSummary) => (c.archived ? 2 : c.joined ? 0 : 1);
  const rows = all
    .filter((c) => c.kind === "channel" && words.every((w) => c.label.toLowerCase().includes(w)))
    .sort((a, b) => rank(a) - rank(b));
  return {
    kind: "channels",
    hasMore: rows.length > offset + limit,
    hits: rows.slice(offset, offset + limit).map((c) => ({
      kind: "channels", id: c.id, title: c.label, subtitle: c.visibility === "private" ? "Private channel" : "Public channel",
      badge: c.archived ? "archived" : c.joined ? "joined" : undefined, muted: c.archived, href: `/chat/${c.id}`,
    })),
  };
}

async function searchMembers(ctx: SearchContext, q: UniversalQuery): Promise<KindResults> {
  const { limit, offset } = page(ctx);
  const words = matchWords(q);
  const staff = ctx.isActingAsAdmin;

  if (staff) {
    // Full members table: email and status are searchable and shown.
    const data = await createRepos(ctx.supabase).members.search({
      words,
      emailContains: q.email || undefined,
      status: q.status || undefined,
      limit: limit + 1, // one extra, to know if there are more
      offset,
    });
    const { rows, hasMore } = finish(data, limit);
    return {
      kind: "members",
      hasMore,
      hits: rows.map((m) => ({
        kind: "members", id: m.id, title: m.name, subtitle: m.email, badge: m.status, href: `/admin/members/${m.id}`,
      })),
    };
  }

  let query = ctx.supabase.from("member_directory").select("id, name, display_name, photo_url, bio");
  query = matchEach(query, words, ["name", "display_name", "bio"]);
  const { data } = await query.order("name").range(offset, offset + limit);
  const { rows, hasMore } = finish(data, limit);
  return {
    kind: "members",
    hasMore,
    hits: rows.map((m) => ({
      kind: "members", id: m.id, title: m.display_name || m.name, subtitle: m.display_name ? m.name : (m.bio ?? undefined),
      imageUrl: m.photo_url, href: `/members/${m.id}`,
    })),
  };
}

async function searchPrickles(ctx: SearchContext, q: UniversalQuery): Promise<KindResults> {
  const { limit, offset } = page(ctx);
  const words = matchWords(q);
  // A prickle is named for its type and host ("Monday Progress Prickle with Jenn P") unless the host
  // gave it a title of its own ("Tiny Things Practice Workshop"), so each word must match the type's
  // name, the host's name or the title.
  const [hosts, wordHosts] = await Promise.all([memberIdsNamed(ctx, q.from), Promise.all(
    words.map(async (w) => {
      const { data } = await ctx.supabase.from("member_directory").select("id").ilike("name", pattern(w).replace(/^"|"$/g, "")).limit(100);
      return { text: w, hostIds: (data ?? []).map((m) => m.id as string) };
    })
  )]);
  if (hosts && hosts.length === 0) return { kind: "prickles", hits: [], hasMore: false };

  const found = await createRepos(ctx.supabase).prickles.search({
    words: wordHosts,
    hostIds: hosts ?? undefined,
    after: q.after || undefined,
    before: q.before || undefined,
    limit: limit + 1, // one extra, to know if there are more
    offset,
  });
  const { rows, hasMore } = finish(found, limit);
  const base = ctx.isActingAsAdmin ? "/admin/prickles" : "/prickles";
  return {
    kind: "prickles",
    hasMore,
    hits: rows.map((p) => ({
      kind: "prickles", id: p.id,
      title: formatPrickleDetailTitle(p),
      date: p.startTime, href: `${base}/${p.id}`,
    })),
  };
}

async function searchBooks(ctx: SearchContext, q: UniversalQuery): Promise<KindResults> {
  const { limit, offset } = page(ctx);
  const authors = await memberIdsNamed(ctx, q.from);
  if (authors && authors.length === 0) return { kind: "books", hits: [], hasMore: false };
  let query = ctx.supabase.from("member_books").select("id, title, description, cover_url, published_date, author:book_member(id, name)");
  query = matchEach(query, matchWords(q), ["title", "description"]);
  if (authors) query = query.in("member_id", authors);
  if (q.after) query = query.gte("published_date", q.after.slice(0, 10));
  if (q.before) query = query.lt("published_date", q.before.slice(0, 10));
  const { data } = await query.order("published_date", { ascending: false }).range(offset, offset + limit);
  const { rows, hasMore } = finish(data, limit);
  return {
    kind: "books",
    hasMore,
    hits: rows.map((b) => {
      const author = Array.isArray(b.author) ? b.author[0] : b.author;
      return { kind: "books", id: b.id, title: b.title, subtitle: author?.name, imageUrl: b.cover_url, date: b.published_date, href: "/bookshelf" };
    }),
  };
}

async function searchAwards(ctx: SearchContext, q: UniversalQuery): Promise<KindResults> {
  const { limit, offset } = page(ctx);
  const winners = await memberIdsNamed(ctx, q.from);
  if (winners && winners.length === 0) return { kind: "awards", hits: [], hasMore: false };
  let query = ctx.supabase.from("member_awards").select("id, award_name, category, work_title, award_date");
  query = matchEach(query, matchWords(q), ["award_name", "category", "work_title"]);
  if (winners) query = query.in("member_id", winners);
  if (q.after) query = query.gte("award_date", q.after.slice(0, 10));
  if (q.before) query = query.lt("award_date", q.before.slice(0, 10));
  const { data } = await query.order("award_date", { ascending: false }).range(offset, offset + limit);
  const { rows, hasMore } = finish(data, limit);
  return {
    kind: "awards",
    hasMore,
    hits: rows.map((a) => ({
      kind: "awards", id: a.id, title: a.award_name, subtitle: [a.work_title, a.category].filter(Boolean).join(" · "),
      date: a.award_date, href: "/projects/awards",
    })),
  };
}

async function searchEvents(ctx: SearchContext, q: UniversalQuery): Promise<KindResults> {
  const { limit, offset } = page(ctx);
  // `from:` on an event means who attended it.
  const attendees = await memberIdsNamed(ctx, q.from);
  let attendedIds: string[] | null = null;
  if (attendees) {
    const { data } = attendees.length
      ? await ctx.supabase.from("event_attendees").select("event_id").in("member_id", attendees).limit(1000)
      : { data: [] };
    attendedIds = [...new Set((data ?? []).map((r) => r.event_id as string))];
    if (attendedIds.length === 0) return { kind: "events", hits: [], hasMore: false };
  }
  let query = ctx.supabase.from("events").select("id, slug, title, event_type, location, starts_at, focus");
  query = matchEach(query, matchWords(q), ["title", "location", "focus", "description"]);
  if (attendedIds) query = query.in("id", attendedIds);
  if (q.after) query = query.gte("starts_at", q.after.slice(0, 10));
  if (q.before) query = query.lt("starts_at", q.before.slice(0, 10));
  const { data } = await query.order("starts_at", { ascending: false }).range(offset, offset + limit);
  const { rows, hasMore } = finish(data, limit);
  const base = ctx.isActingAsAdmin ? "/admin/events" : "/events";
  return {
    kind: "events",
    hasMore,
    hits: rows.map((e) => ({
      kind: "events", id: e.id, title: e.title, subtitle: e.location ?? e.focus ?? undefined, date: e.starts_at,
      href: `${base}/${ctx.isActingAsAdmin ? e.id : e.slug}`,
    })),
  };
}

/** Projects other members chose to show on their profile (the only ones anyone else may see). */
async function searchProjects(ctx: SearchContext, q: UniversalQuery): Promise<KindResults> {
  const { limit, offset } = page(ctx);
  const words = matchWords(q).map((w) => w.toLowerCase());
  const [owners, { data }] = await Promise.all([memberIdsNamed(ctx, q.from), ctx.supabase.rpc("get_member_directory")]);
  const rows = ((data ?? []) as { id: string; name: string; display_name: string | null; photo_url: string | null; projects: string[] }[])
    .filter((m) => !owners || owners.includes(m.id))
    .flatMap((m) => (m.projects ?? []).map((title) => ({ m, title })))
    .filter(({ title }) => words.every((w) => title.toLowerCase().includes(w)));
  const slice = rows.slice(offset, offset + limit);
  return {
    kind: "projects",
    hasMore: rows.length > offset + limit,
    hits: slice.map(({ m, title }) => ({
      kind: "projects", id: `${m.id}:${title}`, title, subtitle: m.display_name || m.name, imageUrl: m.photo_url, href: `/members/${m.id}`,
    })),
  };
}

async function searchChatKind(ctx: SearchContext, q: UniversalQuery): Promise<KindResults> {
  const { limit } = page(ctx);
  if (!ctx.viewerMemberId) return { kind: "chat", hits: [], hasMore: false };
  const started = performance.now();
  const allChannels = typeof ctx.chatChannels === "function" ? await ctx.chatChannels() : ctx.chatChannels;
  const channelsMs = Math.round(performance.now() - started);
  const channels = q.inChannel
    ? allChannels.filter((c) => c.label.replace(/^#/, "").toLowerCase().includes(q.inChannel!.toLowerCase()))
    : allChannels;
  const result = await searchChat(ctx.supabase, ctx.viewerMemberId, {
    tsquery: q.tsquery,
    channels,
    author: q.from && q.from.toLowerCase() !== "me" ? q.from : undefined,
    authorMemberId: q.from?.toLowerCase() === "me" ? ctx.viewerMemberId : undefined,
    from: q.after ?? null,
    to: q.before ?? null,
    hasFiles: q.hasFiles,
    hasLink: q.hasLink,
    hasReaction: q.hasReaction,
    inThread: q.isThread,
    page: Math.floor((ctx.offset ?? 0) / SEARCH_PAGE_SIZE),
  });
  // Chat is the slow kind, so split its time into the channel lookup and the query itself.
  if (ctx.stages) {
    ctx.stages.chat_channels = channelsMs;
    ctx.stages.chat_query = Math.round(performance.now() - started) - channelsMs;
  }
  return {
    kind: "chat",
    hasMore: result.hasMore || result.results.length > limit,
    hits: result.results.slice(0, limit).map((r) => ({
      kind: "chat", id: r.message.id, title: mentionsToPlainText(r.message.body ?? "", result.render), subtitle: `${r.message.authorName} in ${r.channel.label}`,
      date: r.message.createdAt, href: `/chat/${r.threadId}`,
    })),
  };
}

const SEARCHERS: Record<SearchKind, (ctx: SearchContext, q: UniversalQuery) => Promise<KindResults>> = {
  pages: searchPages, channels: searchChannels, members: searchMembers, prickles: searchPrickles, projects: searchProjects, books: searchBooks,
  awards: searchAwards, events: searchEvents, chat: searchChatKind,
};

/**
 * Searches one kind, or every kind (in parallel) when the query names none. A kind that throws
 * comes back empty rather than taking the others down. `chat` is left out when `skip` has it.
 */
export async function universalSearch(
  ctx: SearchContext,
  q: UniversalQuery,
  opts: { skip?: SearchKind[]; /** Filled with each kind's milliseconds, for logging. */ timings?: Record<string, number> } = {}
): Promise<KindResults[]> {
  if (q.unknownKind || !hasCriteria(q)) return [];
  const scoped = q.kind && (SEARCH_KINDS as readonly string[]).includes(q.kind) ? [q.kind as SearchKind] : null;
  // Admin-only kinds (programs, badges, feedback) are not wired up yet.
  if (q.kind && !scoped) return [];
  // Filters only chat has (has:, is:thread, channel:) narrow an unscoped search to chat, so
  // `has:link` never lists members.
  const chatOnly = q.hasFiles || q.hasLink || q.hasReaction || q.isThread || q.inChannel;
  const kinds = (scoped ?? (chatOnly ? (["chat"] as SearchKind[]) : [...SEARCH_KINDS])).filter((k) => !opts.skip?.includes(k));
  const results = await Promise.all(
    kinds.map(async (kind) => {
      // A kind with no column for a filter in the query would list everything, so it sits out.
      if (!kindHonors(kind, q)) return { kind, hits: [], hasMore: false } satisfies KindResults;
      const started = performance.now();
      try {
        return await SEARCHERS[kind](ctx, q);
      } catch (e) {
        console.error(`universal search failed for ${kind}`, e);
        return { kind, hits: [], hasMore: false } satisfies KindResults;
      } finally {
        if (opts.timings) opts.timings[kind] = Math.round(performance.now() - started);
      }
    })
  );
  return results.filter((r) => r.hits.length > 0 || scoped);
}

export { KIND_LABELS };
export type { AnySearchKind, KindResults, SearchHit };
