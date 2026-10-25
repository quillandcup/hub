import { APP_URL } from "@/lib/config";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { createRepos } from "@/lib/data/repos";
import type { InAppNotificationRow, NewInAppNotification } from "@/lib/data/notifications";
import type { SortConfig } from "@/lib/hooks/useTableSort";
import { isAllowedExternalUrl } from "@/lib/notification-links";
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
 * The address is the member id.
 */

/** How many the bell shows; the inbox has the rest. */
export const BELL_LIMIT = 10;

export const inAppChannel: ChannelAdapter = {
  id: "in_app",
  async resolveAddresses(supabase, memberIds) {
    return new Map(memberIds.map((memberId) => [memberId, memberId]));
  },
  async send(memberId, message, context) {
    try {
      await createRepos(createServiceRoleClient()).notifications.addInApp(inAppRow(memberId, message, context));
    } catch (error) {
      throw new Error(`in_app_notifications insert failed: ${(error as Error).message}`);
    }
  },
};

export function inAppRow(memberId: string, message: OutboundMessage, { kind }: SendContext): NewInAppNotification {
  return {
    memberId,
    kind,
    ref: message.ref ?? null,
    text: message.text,
    url: notificationUrl(message.url),
    bannerUntil: message.timeSensitiveUntil ?? null,
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

/** What the bell, inbox and banner link to: a Hub path, or an allowed external link (the Slack workspace). */
export function notificationUrl(url: string | undefined): string | null {
  if (!url) return null;
  return hubPath(url) ?? (isAllowedExternalUrl(url) ? url : null);
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

function toNotification(row: InAppNotificationRow, now: Date): InAppNotification {
  return {
    id: row.id,
    kind: row.kind,
    text: row.text,
    url: row.url,
    createdAt: row.createdAt,
    read: row.readAt !== null,
    banner: row.readAt === null && row.bannerUntil !== null && Date.parse(row.bannerUntil) > now.getTime(),
  };
}

/** A member's latest `limit` notifications, newest first, as of `now` (the bell and banner). */
export async function loadInAppNotifications(
  supabase: any,
  memberId: string,
  now: Date,
  { limit }: { limit: number }
): Promise<InAppNotification[]> {
  try {
    return (await createRepos(supabase).notifications.inAppLatest(memberId, limit)).map((row) => toNotification(row, now));
  } catch (error) {
    console.error("[in-app] Loading notifications failed", { member: memberId, error });
    return [];
  }
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
  const notifications = createRepos(supabase).notifications;
  const count = async (unreadOnly: boolean) => {
    try {
      return await notifications.inAppCount(memberId, { unreadOnly, kind });
    } catch (error) {
      console.error("[in-app] Counting inbox failed", { member: memberId, error });
      return 0;
    }
  };

  const [all, unread] = await Promise.all([count(false), count(true)]);
  const counts = { all, unread };
  const bounds = pageBounds(page, pageSize, counts[filter]);

  let rows: InAppNotificationRow[] = [];
  try {
    rows = await notifications.inAppPage(memberId, {
      unreadOnly: filter === "unread",
      kind,
      sortBy: sort.column,
      ascending: sort.direction === "asc",
      offset: bounds.offset,
      limit: bounds.pageSize,
    });
  } catch (error) {
    console.error("[in-app] Loading inbox failed", { member: memberId, error });
  }

  return {
    items: rows.map((row) => toNotification(row, now)),
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
  try {
    return await createRepos(supabase).notifications.inAppCount(memberId, { unreadOnly });
  } catch (error) {
    console.error("[in-app] Counting notifications failed", { member: memberId, unreadOnly, error });
    return 0;
  }
}

/** Runs a write and reports it the way the server actions read it: `{ error }`, null when it worked. */
async function attempt(write: () => Promise<void>): Promise<{ error: Error | null }> {
  try {
    await write();
    return { error: null };
  } catch (error) {
    return { error: error as Error };
  }
}

/** Marks these of the member's notifications read (scoped to the member, whichever client). */
export async function markInAppNotificationsRead(supabase: any, memberId: string, ids: string[]) {
  return attempt(() => createRepos(supabase).notifications.markInAppRead(memberId, ids));
}

/** Puts these of the member's notifications back to unread (scoped to the member, whichever client). */
export async function markInAppNotificationsUnread(supabase: any, memberId: string, ids: string[]) {
  return attempt(() => createRepos(supabase).notifications.markInAppUnread(memberId, ids));
}

/** Marks every one of the member's notifications read. */
export async function markAllInAppNotificationsRead(supabase: any, memberId: string) {
  return attempt(() => createRepos(supabase).notifications.markAllInAppRead(memberId));
}

/**
 * Marks a member's unread notifications of `kind` about `ref` read once the feature has what it
 * asked for, so they stop asking (e.g. the check-in after they check in, on the web or in Slack):
 * the banner goes and the unread count drops. Works with the member's session client (RLS lets
 * them mark their own) or the service role. Best effort: a failure is logged, never thrown, since
 * the answer itself is already saved.
 */
export async function resolveInAppNotifications(supabase: any, memberId: string, kind: string, ref: string) {
  const { error } = await attempt(() => createRepos(supabase).notifications.resolveInApp(memberId, kind, ref));
  if (error) console.error("[in-app] Resolving notifications failed", { member: memberId, kind, ref, error });
}
