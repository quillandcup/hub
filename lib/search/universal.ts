/**
 * Universal search: one function per resource kind, each returning rows shaped for a grouped
 * result list. Every query runs on the caller's own Supabase client, so RLS decides what they
 * can see (never pass the service-role client). Members come from `member_directory`, which has
 * no email or status; only an admin acting as themselves (not in sudo) searches `members` itself.
 * Chat reuses searchChat (full text, via search_chat_messages). Word matching is `ilike` on the
 * few fields each kind shows: these tables are small, and prickle titles are computed, not stored.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { formatPrickleTitle } from "@/lib/formatters";
import { searchChat, SEARCH_PAGE_SIZE } from "@/lib/chat/search";
import type { ChannelSummary } from "@/lib/chat/load";
import { hasCriteria, SEARCH_KINDS, type AnySearchKind, type SearchKind, type UniversalQuery } from "@/lib/search/syntax";

export const KIND_LABELS: Record<SearchKind, string> = {
  members: "Members",
  prickles: "Prickles",
  projects: "Projects",
  books: "Books",
  awards: "Awards",
  events: "Events",
  chat: "Chat",
};

export interface SearchHit {
  kind: SearchKind;
  id: string;
  title: string;
  /** One gray line under the title. */
  subtitle?: string;
  href: string;
  /** ISO date shown at the right of the row, when the kind has one. */
  date?: string;
  imageUrl?: string | null;
  /** Small label next to the title (a status, an event type). */
  badge?: string;
}

export interface KindResults {
  kind: SearchKind;
  hits: SearchHit[];
  /** More rows exist past this page. */
  hasMore: boolean;
}

export interface SearchContext {
  supabase: SupabaseClient;
  /** The effective member (the sudo'd one when sudo is on). */
  viewerMemberId: string;
  /** An admin acting as themselves: gets email:/status: and admin links. False in sudo. */
  isActingAsAdmin: boolean;
  /** Conversations chat search may look in (what the member's chat lists). */
  chatChannels: ChannelSummary[];
  /** Rows per kind; one extra is fetched to know if there are more. */
  limit?: number;
  offset?: number;
}

/** The positive plain words to match, without quotes; "-excluded" words are skipped. */
export function matchWords(q: UniversalQuery): string[] {
  return (q.text.match(/-?"[^"]*"?|\S+/g) ?? [])
    .filter((t) => !t.startsWith("-"))
    .map((t) => t.replace(/^"|"$|\*$/g, "").trim())
    .filter(Boolean);
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
  if (typed.toLowerCase() === "me") return [ctx.viewerMemberId];
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

async function searchMembers(ctx: SearchContext, q: UniversalQuery): Promise<KindResults> {
  const { limit, offset } = page(ctx);
  const words = matchWords(q);
  const staff = ctx.isActingAsAdmin;

  if (staff) {
    // Full members table: email and status are searchable and shown.
    let query = ctx.supabase.from("members").select("id, name, email, status, joined_at");
    query = matchEach(query, words, ["name", "email"]);
    if (q.email) query = query.ilike("email", pattern(q.email).replace(/^"|"$/g, ""));
    if (q.status) query = query.eq("status", q.status);
    const { data } = await query.order("name").range(offset, offset + limit);
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
  const hosts = await memberIdsNamed(ctx, q.from);
  if (hosts && hosts.length === 0) return { kind: "prickles", hits: [], hasMore: false };

  // A prickle has no title of its own: it is named for its type and host ("Monday Progress Prickle
  // with Jenn P"), so words match the type's name or the host's name.
  let typeIds: string[] | null = null;
  let hostIds: string[] | null = hosts;
  if (words.length > 0) {
    const [types, named] = await Promise.all([
      ctx.supabase.from("prickle_types").select("id").or(words.map((w) => `name.ilike.${pattern(w)}`).join(",")).limit(50),
      hosts ? Promise.resolve(null) : ctx.supabase.from("member_directory").select("id").or(words.map((w) => `name.ilike.${pattern(w)}`).join(",")).limit(100),
    ]);
    typeIds = (types.data ?? []).map((t) => t.id as string);
    if (!hosts) hostIds = (named?.data ?? []).map((m) => m.id as string);
    if (typeIds.length === 0 && (hostIds ?? []).length === 0) return { kind: "prickles", hits: [], hasMore: false };
  }

  let query = ctx.supabase
    .from("prickles")
    .select("id, start_time, host:prickle_host(id, name), prickle_types:type_id(name)");
  if (words.length > 0) {
    const ors = [
      typeIds && typeIds.length ? `type_id.in.(${typeIds.join(",")})` : null,
      hostIds && hostIds.length ? `host.in.(${hostIds.join(",")})` : null,
    ].filter(Boolean);
    query = query.or(ors.join(","));
  } else if (hostIds) {
    query = query.in("host", hostIds);
  }
  if (q.after) query = query.gte("start_time", q.after);
  if (q.before) query = query.lt("start_time", q.before);
  const { data } = await query.order("start_time", { ascending: false }).range(offset, offset + limit);
  const { rows, hasMore } = finish(data, limit);
  const base = ctx.isActingAsAdmin ? "/admin/prickles" : "/prickles";
  return {
    kind: "prickles",
    hasMore,
    hits: rows.map((p) => ({
      kind: "prickles", id: p.id as string,
      // PostgREST types an embedded single row as an array here; formatPrickleTitle accepts either.
      title: formatPrickleTitle(p as unknown as Parameters<typeof formatPrickleTitle>[0]),
      date: p.start_time as string, href: `${base}/${p.id}`,
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
  let query = ctx.supabase.from("events").select("id, slug, title, event_type, location, starts_at, focus");
  query = matchEach(query, matchWords(q), ["title", "location", "focus", "description"]);
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
  const owners = await memberIdsNamed(ctx, q.from);
  const { data } = await ctx.supabase.rpc("get_member_directory");
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
  const channels = q.inChannel
    ? ctx.chatChannels.filter((c) => c.label.replace(/^#/, "").toLowerCase().includes(q.inChannel!.toLowerCase()))
    : ctx.chatChannels;
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
  return {
    kind: "chat",
    hasMore: result.hasMore || result.results.length > limit,
    hits: result.results.slice(0, limit).map((r) => ({
      kind: "chat", id: r.message.id, title: r.message.body ?? "", subtitle: `${r.message.authorName} in ${r.channel.label}`,
      date: r.message.createdAt, href: `/chat/${r.threadId}`,
    })),
  };
}

const SEARCHERS: Record<SearchKind, (ctx: SearchContext, q: UniversalQuery) => Promise<KindResults>> = {
  members: searchMembers, prickles: searchPrickles, projects: searchProjects, books: searchBooks,
  awards: searchAwards, events: searchEvents, chat: searchChatKind,
};

/**
 * Searches one kind, or every kind (in parallel) when the query names none. A kind that throws
 * comes back empty rather than taking the others down. `chat` is left out when `skip` has it.
 */
export async function universalSearch(
  ctx: SearchContext,
  q: UniversalQuery,
  opts: { skip?: SearchKind[] } = {}
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
      try {
        return await SEARCHERS[kind](ctx, q);
      } catch (e) {
        console.error(`universal search failed for ${kind}`, e);
        return { kind, hits: [], hasMore: false } satisfies KindResults;
      }
    })
  );
  return results.filter((r) => r.hits.length > 0 || scoped);
}

export type { AnySearchKind };
