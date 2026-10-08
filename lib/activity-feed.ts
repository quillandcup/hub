import type { SupabaseClient } from "@supabase/supabase-js";
import { pageBounds } from "@/lib/pagination";

/**
 * The central activity log: audit_log rows, member_activities rows and page
 * visit sessions in one shape, from the get_activity_feed() SQL function (see
 * docs/ACTIVITY_AND_AUDIT_LOG.md). The function enforces admin-only itself.
 */

export type FeedKind = "audit" | "activity" | "session";
export const FEED_KINDS: readonly FeedKind[] = ["audit", "activity", "session"];

export const FEED_KIND_LABELS: Record<FeedKind, string> = {
  audit: "Changes",
  activity: "Member activity",
  session: "Page visits",
};

export interface ActivityFeedRow {
  event_id: string;
  kind: FeedKind;
  occurred_at: string;
  is_audit: boolean;
  actor_user_id: string | null;
  actor_kind: "member" | "staff" | "system";
  actor_label: string | null;
  member_id: string | null;
  member_name: string | null;
  /** Set when an admin did this in sudo: the member they were viewing as. */
  acting_as_member_id: string | null;
  acting_as_member_name: string | null;
  event_type: string;
  entity_type: string | null;
  entity_id: string | null;
  title: string | null;
  description: string | null;
  source: string | null;
  data: Record<string, unknown> | null;
}

/**
 * Audit entity types behind the Privacy view: who changed which channels staff can
 * read. Break-glass grants and content reads join this list when they exist
 * (docs/SLACK_BRIDGED_CHAT.md, "Access control").
 */
export const PRIVACY_ENTITY_TYPES: readonly string[] = ["restricted_slack_channel"];

export type FeedView = "audit" | "all" | "privacy";

export interface FeedFilters {
  /**
   * "audit" = only audit-worthy rows (staff/system writes, sudo); "all" = everything;
   * "privacy" = only changes to who can read message content.
   */
  view: FeedView;
  kinds: FeedKind[] | null;
  actorUserId: string | null;
  memberId: string | null;
  /** Only things done by an admin while viewing as a member. */
  sudoOnly: boolean;
  /** Look-back window in days. */
  days: number;
}

/** Filters plus where in the result set we are; page/pageSize come from ?page=&pageSize=. */
export interface FeedQuery extends FeedFilters {
  page: number;
  pageSize: number;
}

export const FEED_DAY_OPTIONS = [1, 7, 30, 90] as const;
const DEFAULT_DAYS = 7;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Param = string | string[] | undefined;
const first = (v: Param) => (Array.isArray(v) ? v[0] : v);

function parseView(view: string | undefined): FeedView {
  return view === "all" || view === "privacy" ? view : "audit";
}

export function parseFeedFilters(params: Record<string, Param>): FeedFilters {
  const kindList = (first(params.kinds) ?? "")
    .split(",")
    .filter((k): k is FeedKind => (FEED_KINDS as readonly string[]).includes(k));
  const days = Number(first(params.days));
  const actor = first(params.actor);
  const member = first(params.member);

  return {
    view: parseView(first(params.view)),
    kinds: kindList.length > 0 ? kindList : null,
    actorUserId: actor && UUID_RE.test(actor) ? actor : null,
    memberId: member && UUID_RE.test(member) ? member : null,
    sudoOnly: first(params.sudo) === "1",
    days: (FEED_DAY_OPTIONS as readonly number[]).includes(days) ? days : DEFAULT_DAYS,
  };
}

/**
 * Query string for a filter set, omitting defaults. Page is deliberately not
 * included: changing a filter starts again on page 1.
 */
export function feedSearch(filters: Partial<FeedFilters>): string {
  const q = new URLSearchParams();
  if (filters.view === "all" || filters.view === "privacy") q.set("view", filters.view);
  if (filters.kinds?.length) q.set("kinds", filters.kinds.join(","));
  if (filters.actorUserId) q.set("actor", filters.actorUserId);
  if (filters.memberId) q.set("member", filters.memberId);
  if (filters.sudoOnly) q.set("sudo", "1");
  if (filters.days && filters.days !== DEFAULT_DAYS) q.set("days", String(filters.days));
  const s = q.toString();
  return s ? `?${s}` : "";
}

function rpcArgs(filters: FeedFilters, now: Date) {
  const from = new Date(now.getTime() - filters.days * 24 * 60 * 60 * 1000);
  return {
    p_audit_only: filters.view === "audit",
    p_kinds: filters.kinds,
    p_entity_types: filters.view === "privacy" ? [...PRIVACY_ENTITY_TYPES] : null,
    p_actor_user_id: filters.actorUserId,
    p_member_id: filters.memberId,
    p_sudo_only: filters.sudoOnly,
    p_from: from.toISOString(),
    p_to: new Date(now.getTime() + 60_000).toISOString(),
  };
}

export interface FeedPage {
  rows: ActivityFeedRow[];
  total: number;
  /** The page actually served, clamped to what exists. */
  page: number;
  pageSize: number;
}

export async function fetchActivityFeed(
  supabase: SupabaseClient,
  query: FeedQuery,
  now: Date = new Date()
): Promise<FeedPage> {
  const args = rpcArgs(query, now);
  const { data: count, error: countError } = await supabase.rpc("count_activity_feed", args);
  if (countError) throw countError;
  const total = (count as number | null) ?? 0;

  const bounds = pageBounds(query.page, query.pageSize, total);
  if (total === 0) return { rows: [], total, page: bounds.page, pageSize: bounds.pageSize };

  const { data, error } = await supabase.rpc("get_activity_feed", {
    ...args,
    p_offset: bounds.offset,
    p_limit: bounds.pageSize,
  });
  if (error) throw error;
  return { rows: (data ?? []) as ActivityFeedRow[], total, page: bounds.page, pageSize: bounds.pageSize };
}

// ---------------------------------------------------------------------------
// Presentation
// ---------------------------------------------------------------------------

const humanize = (s: string) => s.replace(/_/g, " ");

interface FieldChange {
  old: unknown;
  new: unknown;
}

/** Fields of an audit row's `changes` delta, in key order. */
export function changedFields(data: ActivityFeedRow["data"]): Array<[string, FieldChange]> {
  return Object.entries((data ?? {}) as Record<string, FieldChange>).filter(
    ([, v]) => v && typeof v === "object" && "old" in v && "new" in v
  );
}

export function formatValue(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "string") return v.length > 80 ? `${v.slice(0, 77)}…` : v;
  const json = JSON.stringify(v);
  return json.length > 80 ? `${json.slice(0, 77)}…` : json;
}

const ACTION_VERBS: Record<string, string> = {
  insert: "added",
  update: "changed",
  delete: "removed",
};

/** "Bramble Admin (as Fern Quillsby)" when an admin acted in sudo. */
export function actorDisplay(row: ActivityFeedRow): string {
  const name = actorName(row);
  return row.acting_as_member_name ? `${name} (as ${row.acting_as_member_name})` : name;
}

export function actorName(row: ActivityFeedRow): string {
  if (row.actor_kind === "system") return "System";
  return row.actor_label ?? (row.actor_kind === "staff" ? "A staff member" : "A member");
}

/** What member-authored entity types are called in a sentence; others fall back to the humanized type. */
const ENTITY_LABELS: Record<string, string> = {
  writing_project: "writing project",
  writing_goal: "writing goal",
  writing_starting_balance: "starting balance",
  writing_progress_entry: "writing progress entry",
  member_book: "book",
  member_award: "award",
  member_badge: "badge",
  prickle_commitment: "prickle commitment",
  calendar_feed: "calendar link",
  calendar_feed_item: "calendar item",
  wheel_of_wonder_match: "Wheel of Wonder match",
  member_ask_me_about: "“Ask me about” topics",
  restricted_slack_channel: "restricted Slack channel",
};

const NAME_FIELDS = ["title", "name", "alias"] as const;

/** The record's own name (a project's title, an alias...), when its delta carries one. */
function recordName(row: ActivityFeedRow): string | null {
  // The trigger stores the record's name on the row (description), which UPDATE deltas can't carry.
  if (row.description) return formatValue(row.description);
  const fields = Object.fromEntries(changedFields(row.data));
  for (const key of NAME_FIELDS) {
    const change = fields[key];
    const value = change && (row.event_type === "delete" ? change.old : change.new);
    if (typeof value === "string" && value) return formatValue(value);
  }
  return null;
}

/** Phrases for events that read better than "changed calendar link — first fetched at". */
function specialAuditPhrase(row: ActivityFeedRow): string | null {
  const fields = Object.fromEntries(changedFields(row.data));
  if (row.entity_type === "calendar_feed") {
    if (row.event_type === "insert") return "created their calendar link";
    if (fields.first_fetched_at && fields.first_fetched_at.new) return "added their calendar link to a calendar app";
    if (fields.token) return "generated a new calendar link";
  }
  if (row.entity_type === "wheel_of_wonder_match" && row.event_type === "insert") return "spun the Wheel of Wonder";
  if (row.entity_type === "restricted_slack_channel") {
    const channel = row.description ? `#${formatValue(row.description)}` : "a Slack channel";
    if (row.event_type === "insert") return `restricted staff access to messages in ${channel}`;
    if (row.event_type === "delete") return `lifted the restriction on messages in ${channel}`;
  }

  const name = recordName(row);
  const quoted = name ? ` “${name}”` : "";
  if (row.entity_type === "writing_project" && fields.phase && row.event_type === "update") {
    return `moved writing project${quoted} from ${humanize(String(fields.phase.old))} to ${humanize(String(fields.phase.new))}`;
  }
  if (row.entity_type === "member_book") {
    // A book with a project_id came from "Publish" on a project; without one it was added directly.
    if (row.event_type === "insert") {
      return fields.project_id?.new ? `published${quoted} from a writing project` : `added${quoted} to their bookshelf`;
    }
    if (row.event_type === "delete") return `removed${quoted} from their bookshelf`;
  }
  return null;
}

const UUID_SEGMENT = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const titleCase = (s: string) => s.replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

/** "/prickles/<uuid>" -> "Prickles · one", "/my-prickles/all" -> "My Prickles · All": paths read as places. */
export function pageLabel(path: string): string {
  const segments = path.split("?")[0].split("/").filter(Boolean);
  if (segments.length === 0) return "Home";
  const [first, second] = segments;
  const section = titleCase(first);
  if (!second) return section;
  return UUID_SEGMENT.test(second) ? `${section} · one` : `${section} · ${titleCase(second)}`;
}

export interface PageCount {
  label: string;
  count: number;
}

/** A visit's page trail as counts per place, most-visited first: 246 raw paths become a dozen lines. */
export function summarizePages(pages: string[]): PageCount[] {
  const counts = new Map<string, number>();
  for (const path of pages) {
    const label = pageLabel(path);
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  return [...counts.entries()].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count);
}

/** One-line summary of what happened, e.g. "changed member — status". */
export function describeRow(row: ActivityFeedRow): string {
  if (row.kind === "audit") {
    const special = specialAuditPhrase(row);
    if (special) return special;
    const verb = ACTION_VERBS[row.event_type] ?? row.event_type;
    const entity = ENTITY_LABELS[row.entity_type ?? ""] ?? humanize(row.entity_type ?? "record");
    const name = recordName(row);
    const fields = changedFields(row.data).map(([k]) => humanize(k));
    const suffix =
      row.event_type === "update" && fields.length > 0
        ? ` — ${fields.slice(0, 4).join(", ")}${fields.length > 4 ? `, +${fields.length - 4} more` : ""}`
        : "";
    return `${verb} ${entity}${name ? ` “${name}”` : ""}${suffix}`;
  }
  if (row.kind === "session") {
    const pages = Array.isArray(row.data?.pages) ? (row.data.pages as string[]) : [];
    if (pages.length === 0) return "was active (no page views)";
    const top = summarizePages(pages)
      .slice(0, 3)
      .map((p) => `${p.label} ×${p.count}`)
      .join(", ");
    return `visited ${pages.length} page${pages.length === 1 ? "" : "s"}${pages.length > 1 ? ` (${top})` : ""}`;
  }
  const base = row.title ?? humanize(row.event_type);
  // Check-ins and check-outs say where they happened: "(via Slack)" vs "(via web)".
  const via = row.data?.via;
  return typeof via === "string" ? `${base} (via ${via === "slack" ? "Slack" : via})` : base;
}
