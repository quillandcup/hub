import { APP_URL } from "@/lib/config";
import { membersWithFeature } from "@/lib/features.server";
import { createServiceRoleClient } from "@/lib/supabase/service";
import type { ChannelAdapter, OutboundMessage, SendContext } from "./types";

/**
 * "In the Hub", stored in in_app_notifications (migration 20261004000000) and shown by
 * components/InAppNotifications.tsx in two places:
 * - The bell in the member header lists every recent one, with a count of the unread.
 * - A banner under the header shows an unread one while it's time-sensitive
 *   (OutboundMessage.timeSensitiveUntil). Something not time-sensitive, or no longer, is only in
 *   the bell.
 * It's read once the member dismisses the banner or opens the bell, or once the feature resolves
 * it with resolveInAppNotifications (e.g. a check-in once they've checked in). It leaves the list
 * at `expiresAt`, or after IN_APP_LIST_DAYS.
 *
 * Behind the in_app_notifications feature flag: members without it can't be reached here, so
 * senders fall back to their other channels exactly as before. The address is the member id.
 */
export const IN_APP_FEATURE = "in_app_notifications" as const;

/** The bell lists at most this many, newest first... */
export const IN_APP_LIST_LIMIT = 20;
/** ...from at most this far back. */
export const IN_APP_LIST_DAYS = 30;

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
    expires_at: message.expiresAt ?? null,
  };
}

/** A Hub link as a path the bell and banner can navigate to in place; anything else isn't linked. */
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

/** A member's bell list (unexpired, from the last IN_APP_LIST_DAYS, newest first), as of `now`. */
export async function loadInAppNotifications(supabase: any, memberId: string, now: Date): Promise<InAppNotification[]> {
  const since = new Date(now.getTime() - IN_APP_LIST_DAYS * 24 * 60 * 60 * 1000);
  const { data, error } = await supabase
    .from("in_app_notifications")
    .select("id, kind, text, url, created_at, banner_until, read_at")
    .eq("member_id", memberId)
    .gte("created_at", since.toISOString())
    .or(`expires_at.is.null,expires_at.gt.${now.toISOString()}`)
    .order("created_at", { ascending: false })
    .limit(IN_APP_LIST_LIMIT);
  if (error) {
    console.error("[in-app] Loading notifications failed", { member: memberId, error });
    return [];
  }
  return (data ?? []).map((row: any) => ({
    id: row.id,
    kind: row.kind,
    text: row.text,
    url: row.url,
    createdAt: row.created_at,
    read: row.read_at !== null,
    banner: row.read_at === null && row.banner_until !== null && Date.parse(row.banner_until) > now.getTime(),
  }));
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

/**
 * Marks a member's unread notifications of `kind` about `ref` read once the feature has what it
 * asked for, so they stop asking (e.g. the check-in after they check in, on the web or in Slack):
 * the banner goes and the bell's count drops. Works with the member's session client (RLS lets
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
