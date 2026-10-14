"use server";

import { getSearcher, type Searcher } from "@/lib/search/context";
import { recordSearchTimings } from "@/lib/search/metrics";
import { parseUniversal } from "@/lib/search/syntax";
import { universalSearch, type KindResults } from "@/lib/search/universal";
import { MAX_QUERY_LENGTH } from "@/lib/chat/search";
import { loadUnreadCounts } from "@/lib/chat/load";
import { notificationKindLabel } from "@/lib/notifications/inbox";
import { getCheckinPrickles } from "@/lib/upcoming-prickles";
import { checkinAnswered, checkinHref } from "@/lib/prickle-checkins";
import { getMyCheckins } from "@/app/(member)/prickles/checkin-actions";
import { getUnloggedRecentPrickles } from "@/app/(member)/projects/actions";
import { getUserTimezonePreference } from "@/lib/timezone";
import { ORG_TIMEZONE } from "@/lib/config";

export interface PaletteSearch {
  results: KindResults[];
  /** `in:` named a kind that doesn't exist. */
  unknownKind?: string;
  /** Chat messages weren't searched (the palette leaves them to the results page: they are slow). */
  chatSkipped?: boolean;
}

/**
 * The header palette's search: a few rows per kind for what's typed. Runs as the signed-in
 * viewer (see getSearcher); off, signed out or empty gives nothing rather than an error.
 */
export async function searchPalette(input: string): Promise<PaletteSearch> {
  const started = performance.now();
  const searcher = await getSearcher();
  if (!searcher) return { results: [] };
  const setupMs = Math.round(performance.now() - started);
  const query = parseUniversal(input.slice(0, MAX_QUERY_LENGTH));
  if (query.unknownKind) return { results: [], unknownKind: query.unknownKind };
  // Chat is by far the slowest kind (seconds, where the others take well under half a second), so
  // the palette leaves it to the results page unless the search is about chat.
  const chatWanted = query.kind === "chat" || !!(query.hasFiles || query.hasLink || query.hasReaction || query.isThread || query.inChannel);
  const canSearchChat = !searcher.skip.includes("chat");
  const skip = chatWanted ? searcher.skip : [...searcher.skip, "chat" as const];
  const timings: Record<string, number> = {};
  const stages: Record<string, number> = {};
  const results = await universalSearch({ ...searcher.ctx, limit: 4, stages }, query, { skip, timings });
  recordSearchTimings("palette", { setupMs, totalMs: Math.round(performance.now() - started), kindsMs: timings, stagesMs: stages });
  return { results, chatSkipped: canSearchChat && !chatWanted };
}

/** A row of the empty search box's "Needs attention" list. */
export interface Suggestion {
  id: string;
  kind: "checkin" | "chat" | "notification";
  title: string;
  subtitle?: string;
  href: string;
  /** Unread count, shown as a badge. */
  count?: number;
}

const CHECKIN_KINDS = new Set(["prickle_checkin", "prickle_checkout"]);
const MAX_SUGGESTIONS = 8;

/**
 * Open check-ins and check-outs from the prickles themselves, as the dashboard decides them, so
 * they show for members without the in-app notification feature too: a prickle of the member's
 * offering one (checkinOffered: starting soon and hosted, committed to or on their calendar) with no check-in answered, and a recently attended writing
 * prickle with no check-out. Failures give nothing.
 */
async function openCheckins(supabase: Searcher["ctx"]["supabase"], memberId: string): Promise<Suggestion[]> {
  const now = new Date();
  const [tzPref, checkins, unlogged] = await Promise.all([
    getUserTimezonePreference().catch(() => "browser"),
    getMyCheckins().catch(() => ({})),
    getUnloggedRecentPrickles().catch(() => []),
  ]);
  const timeZone = tzPref === "browser" ? ORG_TIMEZONE : tzPref;
  const upcoming = await getCheckinPrickles(supabase, memberId, timeZone, now).catch(() => []);
  const ins: Suggestion[] = upcoming
    .filter((r) => !checkinAnswered((checkins as Record<string, never>)[r.prickle.id] ?? null))
    .map((r) => ({ id: `checkin:${r.prickle.id}`, kind: "checkin" as const, title: r.prickle.typeName, subtitle: "Check in", href: checkinHref(r.prickle.id, "checkin") }));
  const outs: Suggestion[] = unlogged.map((p) => ({ id: `checkout:${p.id}`, kind: "checkin" as const, title: p.label, subtitle: "Check out", href: checkinHref(p.id, "checkout") }));
  return [...ins, ...outs];
}

/**
 * What the empty search box offers before you type: things waiting on the member, open check-ins
 * first (derived from the prickles themselves, plus any unanswered in-app notification not already
 * listed), then chat conversations with unread messages, then other unread notifications. Nothing for an admin in sudo, whose
 * own inbox is not the member's. Failures give an empty list: this is a convenience.
 */
export async function searchSuggestions(): Promise<{ needsAttention: Suggestion[] }> {
  const searcher = await getSearcher();
  if (!searcher || searcher.isSudo || !searcher.ctx.viewerMemberId) return { needsAttention: [] };
  const { supabase, viewerMemberId } = searcher.ctx;
  const chatOn = !searcher.skip.includes("chat");

  const [derived, notifications, unread, channels] = await Promise.all([
    openCheckins(supabase, viewerMemberId).catch(() => [] as Suggestion[]),
    supabase
      .from("in_app_notifications")
      .select("id, kind, text, url")
      .eq("member_id", viewerMemberId)
      .is("read_at", null)
      .order("created_at", { ascending: false })
      .limit(20)
      .then((r) => r.data ?? [], () => []),
    chatOn ? loadUnreadCounts(supabase).catch(() => ({} as Record<string, number>)) : Promise.resolve({} as Record<string, number>),
    chatOn && typeof searcher.ctx.chatChannels === "function" ? searcher.ctx.chatChannels().catch(() => []) : Promise.resolve([]),
  ]);

  const toSuggestion = (n: { id: string; kind: string; text: string; url: string | null }): Suggestion => ({
    id: `notification:${n.id}`,
    kind: CHECKIN_KINDS.has(n.kind) ? "checkin" : "notification",
    title: n.text,
    subtitle: notificationKindLabel(n.kind),
    href: n.url ?? "/notifications",
  });
  // A notification for a prickle already listed from its own data is the same item.
  const covered = (href: string) => derived.some((d) => href.includes(d.id.split(":")[1]));
  const checkins = [...derived, ...notifications.filter((n) => CHECKIN_KINDS.has(n.kind) && !covered(n.url ?? "")).map(toSuggestion)];
  const others = notifications.filter((n) => !CHECKIN_KINDS.has(n.kind)).map(toSuggestion);
  const chat: Suggestion[] = channels
    .filter((c) => (unread[c.id] ?? 0) > 0)
    .sort((a, b) => unread[b.id] - unread[a.id])
    .map((c) => ({ id: `chat:${c.id}`, kind: "chat" as const, title: c.label, subtitle: "Unread messages", href: `/chat/${c.id}`, count: unread[c.id] }));

  return { needsAttention: [...checkins, ...chat, ...others].slice(0, MAX_SUGGESTIONS) };
}

/** One autocomplete choice for an operator's value (`from:` → a member, `channel:` → a chat channel). */
export interface OperatorValue {
  /** What goes after the colon (quoted by the caller when it has spaces). */
  value: string;
  label: string;
  sublabel?: string;
  imageUrl?: string | null;
}

const VALUE_LIMIT = 6;

/** Members or channels whose name contains what was typed after `from:` / `channel:`; "me" leads for `from:`. */
export async function suggestOperatorValues(operator: "from" | "channel", typed: string): Promise<OperatorValue[]> {
  const searcher = await getSearcher();
  if (!searcher) return [];
  const needle = typed.replace(/^[#@"]|"$/g, "").trim().toLowerCase();

  if (operator === "channel") {
    const channels = typeof searcher.ctx.chatChannels === "function" ? await searcher.ctx.chatChannels() : searcher.ctx.chatChannels;
    return channels
      .filter((c) => c.kind === "channel" && c.label.replace(/^#/, "").toLowerCase().includes(needle))
      .slice(0, VALUE_LIMIT)
      .map((c) => ({ value: c.label.replace(/^#/, ""), label: c.label, sublabel: c.visibility === "private" ? "Private channel" : undefined }));
  }

  const out: OperatorValue[] = [];
  if ("me".startsWith(needle)) out.push({ value: "me", label: "Me", sublabel: "Your own" });
  const like = `%${needle.replace(/[\\%_,()"]/g, " ").trim()}%`;
  const { data } = await searcher.ctx.supabase
    .from("member_directory")
    .select("id, name, display_name, photo_url")
    .or(`name.ilike."${like}",display_name.ilike."${like}"`)
    .order("name")
    .limit(VALUE_LIMIT);
  for (const m of data ?? []) {
    out.push({ value: m.name, label: m.display_name || m.name, sublabel: m.display_name && m.display_name !== m.name ? m.name : undefined, imageUrl: m.photo_url });
  }
  return out.slice(0, VALUE_LIMIT);
}
