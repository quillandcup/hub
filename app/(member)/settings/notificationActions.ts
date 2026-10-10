"use server";

import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import { getEffectiveIdentity } from "@/lib/sudo";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { membersWithFeature } from "@/lib/features.server";
import { IN_APP_FEATURE } from "@/lib/channels/in-app";
import { WEB_PUSH_FEATURE, loadPushDevices, vapidKeys, webPushChannel } from "@/lib/channels/web-push";
import { NOTIFICATION_SETTINGS_PATH } from "@/lib/notifications/notify";
import { describeDevice } from "@/lib/device-label";
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

export interface PushDeviceRow {
  id: string;
  label: string;
  addedAt: string;
  lastSentAt: string | null;
  /** The browser asking: its endpoint matches this subscription. */
  isThisDevice: boolean;
}

/** The effective member's devices that get Browser notifications, marking the one asking (by its endpoint). */
export async function listPushDevices(currentEndpoint: string | null): Promise<PushDeviceRow[]> {
  const user = await getCurrentUser();
  if (!user) return [];
  const identity = await getEffectiveIdentity(user);
  if (!identity) return [];
  try {
    const devices = await loadPushDevices(createServiceRoleClient(), identity.memberId);
    return devices.map((d) => ({
      id: d.id,
      label: describeDevice(d.userAgent),
      addedAt: d.createdAt,
      lastSentAt: d.lastSentAt,
      isThisDevice: currentEndpoint !== null && d.endpoint === currentEndpoint,
    }));
  } catch (error) {
    console.error("[notifications] Loading push devices failed", { member: identity.memberId, error });
    return [];
  }
}

/** Stop sending to one of the member's devices from another (a lost phone). The device's own browser subscription lapses on its next 404/410. */
export async function removePushDevice(id: string): Promise<{ success: true } | { error: string }> {
  const user = await getCurrentUser();
  if (!user) return { error: "Not authenticated" };
  const identity = await getEffectiveIdentity(user);
  if (!identity) return { error: "No member record" };
  if (identity.isSudo) return { error: "Notification settings can't be changed in sudo mode." };
  if (typeof id !== "string" || !id) return { error: "Invalid device" };

  const { error } = await createServiceRoleClient()
    .from("push_subscriptions")
    .update({ deleted_at: new Date().toISOString() })
    .eq("member_id", identity.memberId)
    .eq("id", id)
    .is("deleted_at", null);
  if (error) {
    console.error("[notifications] Removing push device failed", { member: identity.memberId, id, error });
    return { error: "Couldn't remove that device — please try again." };
  }
  return { success: true };
}

/** Send the member a Browser notification right now, to every device they've turned it on for. Skips preferences: they asked. */
export async function sendTestPushNotification(): Promise<{ success: true } | { error: string }> {
  const user = await getCurrentUser();
  if (!user) return { error: "Not authenticated" };
  const identity = await getEffectiveIdentity(user);
  if (!identity) return { error: "No member record" };
  if (identity.isSudo) return { error: "Test notifications can't be sent in sudo mode." };

  const service = createServiceRoleClient();
  const reachable = await webPushChannel.resolveAddresses(service, [identity.memberId]);
  if (!reachable.has(identity.memberId)) return { error: "No device has Browser notifications turned on." };

  try {
    await webPushChannel.send(
      identity.memberId,
      { title: "Test notification", text: "Browser notifications are working on this device.", url: NOTIFICATION_SETTINGS_PATH },
      { kind: "test", memberId: identity.memberId }
    );
  } catch (error) {
    console.error("[notifications] Test push failed", { member: identity.memberId, error });
    const reason = error instanceof Error ? error.message : String(error);
    return { error: `Couldn't send the test: ${reason}. Try turning notifications off and on again for this device.` };
  }
  return { success: true };
}
