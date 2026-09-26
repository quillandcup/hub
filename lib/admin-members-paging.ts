// Server-side paging for the admin All Members page. One ordered, ranged RPC
// for the visible page and one for the filter-tab counts, instead of loading
// every member plus their full attendance history on each view. Metrics are
// computed in SQL (supabase/migrations/20260926001000_admin_members_paging.sql)
// with the same rules as lib/member-engagement.ts.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { SortConfig } from "@/lib/hooks/useTableSort";
import { pageBounds } from "@/lib/pagination";

export const MEMBER_SORT_COLUMNS = [
  "name",
  "email",
  "status",
  "last_attended_at",
  "prickles_last_30_days",
  "total_prickles",
  "engagement_score",
  "risk_level",
] as const;
export type MemberSortColumn = (typeof MEMBER_SORT_COLUMNS)[number];

export const DEFAULT_MEMBER_SORT: SortConfig<MemberSortColumn> = { column: "name", direction: "asc" };

export const MEMBER_FILTERS = [
  "all",
  "active",
  "at_risk",
  "highly_engaged",
  "on_hiatus",
  "lead",
  "cancelled",
  "unregistered",
] as const;
export type MemberFilter = (typeof MEMBER_FILTERS)[number];
export type MemberFilterCounts = Record<MemberFilter, number>;

export interface AdminMemberPageRow {
  id: string;
  name: string;
  email: string;
  status: string;
  user_id: string | null;
  last_attended_at: string | null;
  prickles_last_30_days: number;
  total_prickles: number;
  engagement_score: number;
  risk_level: "high" | "medium" | "low";
  engagement_tier: "highly_engaged" | "active" | "at_risk";
  total_count: number;
}

// Shape MembersTable renders.
export function toMemberTableRow(row: AdminMemberPageRow) {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    status: row.status,
    user_id: row.user_id,
    member_metrics: {
      last_attended_at: row.last_attended_at,
      prickles_last_30_days: row.prickles_last_30_days,
      total_prickles: row.total_prickles,
      engagement_score: row.engagement_score,
    },
    member_engagement: {
      risk_level: row.risk_level,
      engagement_tier: row.engagement_tier,
    },
  };
}

export async function fetchAdminMembersPage(
  supabase: SupabaseClient,
  {
    filter,
    search,
    sort,
    page,
    pageSize,
    now = new Date(),
  }: {
    filter: MemberFilter;
    search: string;
    sort: SortConfig<MemberSortColumn>;
    page: number;
    pageSize: number;
    now?: Date;
  }
) {
  const counts = await fetchFilterCounts(supabase, search, now);
  // Clamp the page against the known total so a stale ?page= past the end
  // lands on the last page instead of an empty one.
  const bounds = pageBounds(page, pageSize, counts[filter]);

  const { data, error } = await supabase.rpc("admin_members_page", {
    p_filter: filter,
    p_search: search || null,
    p_sort: sort.column,
    p_direction: sort.direction,
    p_limit: bounds.pageSize,
    p_offset: bounds.offset,
    p_now: now.toISOString(),
  });
  if (error) throw error;

  const rows = (data ?? []) as AdminMemberPageRow[];
  return {
    members: rows.map(toMemberTableRow),
    total: rows.length > 0 ? Number(rows[0].total_count) : counts[filter],
    page: bounds.page,
    pageSize: bounds.pageSize,
    counts,
  };
}

async function fetchFilterCounts(supabase: SupabaseClient, search: string, now: Date): Promise<MemberFilterCounts> {
  const { data, error } = await supabase.rpc("admin_member_filter_counts", {
    p_search: search || null,
    p_now: now.toISOString(),
  });
  if (error) throw error;
  const row = (Array.isArray(data) ? data[0] : data) ?? {};
  return Object.fromEntries(MEMBER_FILTERS.map((f) => [f, Number(row[f] ?? 0)])) as MemberFilterCounts;
}
