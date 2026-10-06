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

export interface FeedFilters {
  /** "audit" = only audit-worthy rows (staff/system writes, sudo); "all" = everything. */
  view: "audit" | "all";
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

export function parseFeedFilters(params: Record<string, Param>): FeedFilters {
  const kindList = (first(params.kinds) ?? "")
    .split(",")
    .filter((k): k is FeedKind => (FEED_KINDS as readonly string[]).includes(k));
  const days = Number(first(params.days));
  const actor = first(params.actor);
  const member = first(params.member);

  return {
    view: first(params.view) === "all" ? "all" : "audit",
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
  if (filters.view === "all") q.set("view", "all");
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

/** One-line summary of what happened, e.g. "changed member — status". */
export function describeRow(row: ActivityFeedRow): string {
  if (row.kind === "audit") {
    const verb = ACTION_VERBS[row.event_type] ?? row.event_type;
    const entity = humanize(row.entity_type ?? "record");
    const fields = changedFields(row.data).map(([k]) => humanize(k));
    const suffix =
      row.event_type === "update" && fields.length > 0
        ? ` — ${fields.slice(0, 4).join(", ")}${fields.length > 4 ? `, +${fields.length - 4} more` : ""}`
        : "";
    return `${verb} ${entity}${suffix}`;
  }
  if (row.kind === "session") {
    const count = Array.isArray(row.data?.pages) ? (row.data.pages as unknown[]).length : 0;
    return count > 0 ? `visited ${count} page${count === 1 ? "" : "s"}` : "was active (no page views)";
  }
  return row.title ?? humanize(row.event_type);
}
