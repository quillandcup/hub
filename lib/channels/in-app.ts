import { APP_URL } from "@/lib/config";
import { membersWithFeature } from "@/lib/features.server";
import { createServiceRoleClient } from "@/lib/supabase/service";
import type { ChannelAdapter, OutboundMessage, SendContext } from "./types";

/**
 * "In the Hub": a banner at the top of the member pages (components/InAppNotificationBanner.tsx),
 * stored in in_app_notifications (migration 20261004000000). Behind the in_app_notifications
 * feature flag: members without it can't be reached here, so senders fall back to their other
 * channels exactly as before. The address is the member id.
 *
 * A banner shows until the member dismisses it, it reaches `expiresAt`, or the feature clears it
 * with resolveInAppNotifications once it's dealt with (e.g. a check-in banner once they check in).
 */
export const IN_APP_FEATURE = "in_app_notifications" as const;

/** How many banners show at once (newest first); older ones wait their turn. */
export const MAX_ACTIVE_IN_APP = 3;

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
    expires_at: message.expiresAt ?? null,
  };
}

/** A Hub link as a path the banner can navigate to in place; anything else isn't linked. */
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
}

/** A member's banners still worth showing: undismissed and unexpired, newest first. */
export async function loadActiveInAppNotifications(
  supabase: any,
  memberId: string,
  now: Date
): Promise<InAppNotification[]> {
  const { data, error } = await supabase
    .from("in_app_notifications")
    .select("id, kind, text, url, created_at")
    .eq("member_id", memberId)
    .is("dismissed_at", null)
    .or(`expires_at.is.null,expires_at.gt.${now.toISOString()}`)
    .order("created_at", { ascending: false })
    .limit(MAX_ACTIVE_IN_APP);
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
  }));
}

/**
 * Clears a member's banners of `kind` about `ref` once the feature has what it asked for, so they
 * don't linger (e.g. the check-in banner after they check in, on the web or in Slack). Works with
 * the member's session client (RLS lets them dismiss their own) or the service role. Best effort:
 * a failure is logged, never thrown, since the answer itself is already saved.
 */
export async function resolveInAppNotifications(supabase: any, memberId: string, kind: string, ref: string) {
  const { error } = await supabase
    .from("in_app_notifications")
    .update({ dismissed_at: new Date().toISOString() })
    .eq("member_id", memberId)
    .eq("kind", kind)
    .eq("ref", ref)
    .is("dismissed_at", null);
  if (error) console.error("[in-app] Clearing notifications failed", { member: memberId, kind, ref, error });
}
