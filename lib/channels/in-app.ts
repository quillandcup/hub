import { APP_URL } from "@/lib/config";
import { membersWithFeature } from "@/lib/features.server";
import { createServiceRoleClient } from "@/lib/supabase/service";
import type { SortConfig } from "@/lib/hooks/useTableSort";
import { pageBounds } from "@/lib/pagination";
import type { InboxFilter, InboxFilterCounts, InboxSortColumn } from "@/lib/notifications/inbox";
import type { ChannelAdapter, OutboundMessage, SendContext } from "./types";

/**
 * "In the Hub", stored in in_app_notifications (migration 20261004000000) and shown by
 * components/InAppNotifications.tsx:
 * - The bell in the member header: an unread count, the latest few, "Mark all as read", and a
 *   link to the inbox (/notifications): every one, as a sortable, filterable, paginated table.
 * - A banner under the header for an unread one while it's time-sensitive
 *   (OutboundMessage.timeSensitiveUntil). Something not time-sensitive, or no longer, is only in
 *   the bell and inbox.
 * Nothing is ever dropped. It's read once the member opens it, dismisses its banner or marks all
 * read, or once the feature resolves it with resolveInAppNotifications (e.g. a check-in once
 * they've checked in).
 *
 * Behind the in_app_notifications feature flag: members without it can't be reached here, so
 * senders fall back to their other channels exactly as before. The address is the member id.
 */
export const IN_APP_FEATURE = "in_app_notifications" as const;

/** How many the bell shows; the inbox has the rest. */
export const BELL_LIMIT = 10;

export const inAppChannel: ChannelAdapter = {
  id: "in_app",
  async resolveAddresses(supabase, memberIds) {
    const reachable = await membersWithFeature(supabase, IN_APP_FEATURE, memberIds);
    return new Map([...reachable].map((memberId) => [memberId, memberId]));
  },
  async send(memberId, message, context) {
    const { error } = await createServiceRoleClient().from("in_app_notifications").insert(inAppRow(memberId, message, context));
    if (error) throw new Error(`in_app_notifications insert failed: ${error.message}`);
  },
};

export function inAppRow(memberId: string, message: OutboundMessage, { kind }: SendContext) {
  return {
    member_id: memberId,
    kind,
    ref: message.ref ?? null,
    text: message.text,
    url: hubPath(message.url),
    banner_until: message.timeSensitiveUntil ?? null,
  };
}

/** A Hub link as a path the bell, inbox and banner can navigate to in place; anything else isn't linked. */
export function hubPath(url: string | undefined): string | null {
  if (!url) return null;
  if (url.startsWith("/") && !url.startsWith("//")) return url;
  if (url === APP_URL) return "/";
  if (url.startsWith(`${APP_URL}/`) || url.startsWith(`${APP_URL}?`)) return url.slice(APP_URL.length);
  return null;
}

export interface InAppNotification {
  id: string;
  kind: string;
  text: string;
  url: string | null;
  createdAt: string;
  read: boolean;
  /** Unread and still time-sensitive (as of the read): shown as a banner too. */
  banner: boolean;
}

const COLUMNS = "id, kind, text, url, created_at, banner_until, read_at";

function toNotification(row: any, now: Date): InAppNotification {
  return {
    id: row.id,
    kind: row.kind,
    text: row.text,
    url: row.url,
    createdAt: row.created_at,
    read: row.read_at !== null,
    banner: row.read_at === null && row.banner_until !== null && Date.parse(row.banner_until) > now.getTime(),
  };
}

/** A member's latest `limit` notifications, newest first, as of `now` (the bell and banner). */
export async function loadInAppNotifications(
  supabase: any,
  memberId: string,
  now: Date,
  { limit }: { limit: number }
): Promise<InAppNotification[]> {
  const { data, error } = await supabase
    .from("in_app_notifications")
    .select(COLUMNS)
    .eq("member_id", memberId)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(limit);
  if (error) {
    console.error("[in-app] Loading notifications failed", { member: memberId, error });
    return [];
  }
  return (data ?? []).map((row: any) => toNotification(row, now));
}

export interface InboxPage {
  items: InAppNotification[];
  /** Matching the filter and kind, across every page. */
  total: number;
  /** Per filter tab, for the kind chosen. */
  counts: InboxFilterCounts;
  /** What was served: `page` clamped to the last page. */
  page: number;
  pageSize: number;
}

/**
 * One page of the /notifications inbox: the member's notifications matching `filter` and `kind`
 * (null = every kind), sorted (newest first breaks ties). Counts come from the same filters, so the
 * pager and tab counts agree with the rows; a page past the end serves the last one.
 */
export async function loadInboxPage(
  supabase: any,
  memberId: string,
  now: Date,
  {
    filter,
    kind,
    sort,
    page,
    pageSize,
  }: { filter: InboxFilter; kind: string | null; sort: SortConfig<InboxSortColumn>; page: number; pageSize: number }
): Promise<InboxPage> {
  const scoped = (query: any) => {
    let q = query.eq("member_id", memberId);
    if (kind) q = q.eq("kind", kind);
    return q;
  };
  const count = async (unread: boolean) => {
    let q = scoped(supabase.from("in_app_notifications").select("id", { count: "exact", head: true }));
    if (unread) q = q.is("read_at", null);
    const { count: n, error } = await q;
    if (error) console.error("[in-app] Counting inbox failed", { member: memberId, error });
    return n ?? 0;
  };

  const [all, unread] = await Promise.all([count(false), count(true)]);
  const counts = { all, unread };
  const bounds = pageBounds(page, pageSize, counts[filter]);

  let rows = scoped(supabase.from("in_app_notifications").select(COLUMNS));
  if (filter === "unread") rows = rows.is("read_at", null);
  rows = rows.order(sort.column, { ascending: sort.direction === "asc" });
  if (sort.column !== "created_at") rows = rows.order("created_at", { ascending: false });
  const { data, error } = await rows
    .order("id", { ascending: false })
    .range(bounds.offset, bounds.offset + bounds.pageSize - 1);
  if (error) console.error("[in-app] Loading inbox failed", { member: memberId, error });

  return {
    items: (data ?? []).map((row: any) => toNotification(row, now)),
    total: counts[filter],
    counts,
    page: bounds.page,
    pageSize: bounds.pageSize,
  };
}

/** How many notifications the member has (all of them, not just a page's), or just the unread. */
export async function countInAppNotifications(
  supabase: any,
  memberId: string,
  { unreadOnly = false }: { unreadOnly?: boolean } = {}
): Promise<number> {
  let query = supabase
    .from("in_app_notifications")
    .select("id", { count: "exact", head: true })
    .eq("member_id", memberId);
  if (unreadOnly) query = query.is("read_at", null);
  const { count, error } = await query;
  if (error) {
    console.error("[in-app] Counting notifications failed", { member: memberId, unreadOnly, error });
    return 0;
  }
  return count ?? 0;
}

/** Marks these of the member's notifications read (scoped to the member, whichever client). */
export async function markInAppNotificationsRead(supabase: any, memberId: string, ids: string[]) {
  return supabase
    .from("in_app_notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("member_id", memberId)
    .in("id", ids)
    .is("read_at", null);
}

/** Puts these of the member's notifications back to unread (scoped to the member, whichever client). */
export async function markInAppNotificationsUnread(supabase: any, memberId: string, ids: string[]) {
  return supabase
    .from("in_app_notifications")
    .update({ read_at: null })
    .eq("member_id", memberId)
    .in("id", ids)
    .not("read_at", "is", null);
}

/** Marks every one of the member's notifications read. */
export async function markAllInAppNotificationsRead(supabase: any, memberId: string) {
  return supabase
    .from("in_app_notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("member_id", memberId)
    .is("read_at", null);
}

/**
 * Marks a member's unread notifications of `kind` about `ref` read once the feature has what it
 * asked for, so they stop asking (e.g. the check-in after they check in, on the web or in Slack):
 * the banner goes and the unread count drops. Works with the member's session client (RLS lets
 * them mark their own) or the service role. Best effort: a failure is logged, never thrown, since
 * the answer itself is already saved.
 */
export async function resolveInAppNotifications(supabase: any, memberId: string, kind: string, ref: string) {
  const { error } = await supabase
    .from("in_app_notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("member_id", memberId)
    .eq("kind", kind)
    .eq("ref", ref)
    .is("read_at", null);
  if (error) console.error("[in-app] Resolving notifications failed", { member: memberId, kind, ref, error });
}
