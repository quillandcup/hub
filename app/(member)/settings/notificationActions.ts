"use server";

import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import { getEffectiveIdentity } from "@/lib/sudo";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { membersWithFeature } from "@/lib/features.server";
import { IN_APP_FEATURE } from "@/lib/channels/in-app";
import { WEB_PUSH_FEATURE, vapidKeys } from "@/lib/channels/web-push";
import {
  NOTIFICATION_CHANNELS,
  effectiveSettings,
  isNotificationChannel,
  isNotificationKind,
  type NotificationChannelId,
  type NotificationKindId,
} from "@/lib/notifications/registry";

export interface NotificationSettings {
  /**
   * Channels this member can use, as switches: "In the Hub" only with the in_app_notifications
   * flag, "Browser" only with browser_notifications (and the VAPID keys set).
   */
  channels: NotificationChannelId[];
  /** The VAPID public key devices subscribe with; null when the member can't turn Browser notifications on. */
  webPushPublicKey: string | null;
  channelsByKind: Record<NotificationKindId, NotificationChannelId[]>;
  /** True in sudo: an admin can see a member's settings but not change them. */
  readOnly: boolean;
}

/** The effective member's notification settings (defaults with their overrides applied). */
export async function getNotificationSettings(): Promise<NotificationSettings | null> {
  const user = await getCurrentUser();
  if (!user) return null;
  const identity = await getEffectiveIdentity(user);
  if (!identity) return null;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("notification_preferences")
    .select("kind, channel, enabled")
    .eq("member_id", identity.memberId);
  if (error) console.error("[notifications] Loading settings failed", { member: identity.memberId, error });

  // The member's flag, not the signed-in admin's in sudo. Service role: it reads their previews.
  const service = createServiceRoleClient();
  const [inApp, browserFlag] = await Promise.all([
    membersWithFeature(service, IN_APP_FEATURE, [identity.memberId]),
    membersWithFeature(service, WEB_PUSH_FEATURE, [identity.memberId]),
  ]);
  const webPushPublicKey = browserFlag.has(identity.memberId) ? (vapidKeys()?.publicKey ?? null) : null;
  const channels = NOTIFICATION_CHANNELS.map((c) => c.id).filter(
    (id) => (id !== "in_app" || inApp.has(identity.memberId)) && (id !== "web_push" || webPushPublicKey !== null)
  );

  return { channels, webPushPublicKey, channelsByKind: effectiveSettings(data ?? []), readOnly: identity.isSudo };
}

/**
 * Turn one kind of notification on or off for one channel. Stores the choice even when it matches
 * today's default, so it sticks if the default changes. Refused in sudo (RLS also keeps writes
 * owner-only).
 */
export async function setNotificationChannel(
  kind: string,
  channel: string,
  enabled: boolean
): Promise<{ success: true } | { error: string }> {
  const user = await getCurrentUser();
  if (!user) return { error: "Not authenticated" };
  const identity = await getEffectiveIdentity(user);
  if (!identity) return { error: "No member record" };
  if (identity.isSudo) return { error: "Notification settings can't be changed in sudo mode." };

  if (!isNotificationKind(kind) || !isNotificationChannel(channel) || typeof enabled !== "boolean") {
    return { error: "Invalid notification setting" };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("notification_preferences")
    .upsert({ member_id: identity.memberId, kind, channel, enabled }, { onConflict: "member_id,kind,channel" });
  if (error) {
    console.error("[notifications] Saving setting failed", { member: identity.memberId, kind, channel, error });
    return { error: "Couldn't save that setting — please try again." };
  }
  return { success: true };
}

/** A browser's PushSubscription, as `subscription.toJSON()` gives it. */
export interface PushSubscriptionInput {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

function validSubscription(input: PushSubscriptionInput): boolean {
  const { endpoint, keys } = input ?? ({} as PushSubscriptionInput);
  if (typeof endpoint !== "string" || typeof keys?.p256dh !== "string" || typeof keys?.auth !== "string") return false;
  if (!keys.p256dh || !keys.auth || endpoint.length > 2048) return false;
  // Push services are always HTTPS; refusing anything else keeps the server from being pointed at arbitrary URLs.
  try {
    return new URL(endpoint).protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Remember this browser as a device to send Browser notifications to. Written with the service
 * role (the table holds push credentials, so members can't touch it directly), after checking who's
 * asking. Subscribing the same browser again reuses its row and revives it if it had been removed;
 * a browser that moved to another member's account moves with it.
 */
export async function savePushSubscription(
  subscription: PushSubscriptionInput,
  userAgent: string | null
): Promise<{ success: true } | { error: string }> {
  const user = await getCurrentUser();
  if (!user) return { error: "Not authenticated" };
  const identity = await getEffectiveIdentity(user);
  if (!identity) return { error: "No member record" };
  if (identity.isSudo) return { error: "Notification settings can't be changed in sudo mode." };
  if (!validSubscription(subscription)) return { error: "Invalid push subscription" };

  const service = createServiceRoleClient();
  if (!(await membersWithFeature(service, WEB_PUSH_FEATURE, [identity.memberId])).has(identity.memberId)) {
    return { error: "Browser notifications aren't available to you yet." };
  }

  const { error } = await service.from("push_subscriptions").upsert(
    {
      member_id: identity.memberId,
      endpoint: subscription.endpoint,
      p256dh: subscription.keys.p256dh,
      auth: subscription.keys.auth,
      user_agent: typeof userAgent === "string" ? userAgent.slice(0, 500) : null,
      deleted_at: null,
    },
    { onConflict: "endpoint" }
  );
  if (error) {
    console.error("[notifications] Saving push subscription failed", { member: identity.memberId, error });
    return { error: "Couldn't turn on notifications for this device — please try again." };
  }
  return { success: true };
}

/** Stop sending Browser notifications to this device (soft delete; only the member's own subscription). */
export async function removePushSubscription(endpoint: string): Promise<{ success: true } | { error: string }> {
  const user = await getCurrentUser();
  if (!user) return { error: "Not authenticated" };
  const identity = await getEffectiveIdentity(user);
  if (!identity) return { error: "No member record" };
  if (identity.isSudo) return { error: "Notification settings can't be changed in sudo mode." };
  if (typeof endpoint !== "string" || !endpoint) return { error: "Invalid push subscription" };

  const { error } = await createServiceRoleClient()
    .from("push_subscriptions")
    .update({ deleted_at: new Date().toISOString() })
    .eq("member_id", identity.memberId)
    .eq("endpoint", endpoint)
    .is("deleted_at", null);
  if (error) {
    console.error("[notifications] Removing push subscription failed", { member: identity.memberId, error });
    return { error: "Couldn't turn off notifications for this device — please try again." };
  }
  return { success: true };
}
