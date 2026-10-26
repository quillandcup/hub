"use server";

import { createRepos } from "@/lib/data/repos";
import type { NotificationPreference } from "@/lib/data/notifications";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import { getEffectiveIdentity } from "@/lib/sudo";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { membersWithFeature } from "@/lib/features.server";
import type { FeatureKey } from "@/lib/features";
import { WEB_PUSH_FEATURE, loadPushDevices, vapidKeys, webPushChannel } from "@/lib/channels/web-push";
import { NOTIFICATION_SETTINGS_PATH } from "@/lib/notifications/notify";
import { isAllowedPushEndpoint } from "@/lib/push-endpoint";
import { describeDevice } from "@/lib/device-label";
import {
  NOTIFICATION_CHANNELS,
  NOTIFICATION_KINDS,
  effectiveSettings,
  isNotificationChannel,
  isNotificationKind,
  type NotificationChannelId,
  type NotificationKindId,
} from "@/lib/notifications/registry";

import { withAction } from "@/lib/analytics/server";
export interface NotificationSettings {
  /**
   * Channels this member can use, as switches: "Browser" only with browser_notifications (and the VAPID keys set).
   */
  channels: NotificationChannelId[];
  /** The VAPID public key devices subscribe with; null when the member can't turn Browser notifications on. */
  webPushPublicKey: string | null;
  channelsByKind: Record<NotificationKindId, NotificationChannelId[]>;
  /** Kinds this member can see: those with no feature preview, or whose preview they have on. */
  visibleKinds: NotificationKindId[];
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
  let stored: NotificationPreference[] = [];
  try {
    stored = await createRepos(supabase).notifications.preferencesOf(identity.memberId);
  } catch (error) {
    console.error("[notifications] Loading settings failed", { member: identity.memberId, error });
  }

  // The member's flag, not the signed-in admin's in sudo. Service role: it reads their previews.
  const service = createServiceRoleClient();
  const kindFeatures = [...new Set(NOTIFICATION_KINDS.flatMap((k) => ("feature" in k ? [k.feature as FeatureKey] : [])))];
  const [browserFlag, ...kindFeatureMembers] = await Promise.all([
    membersWithFeature(service, WEB_PUSH_FEATURE, [identity.memberId]),
    ...kindFeatures.map((key) => membersWithFeature(service, key, [identity.memberId])),
  ]);
  const featureOn = new Set(kindFeatures.filter((_, i) => kindFeatureMembers[i].has(identity.memberId)));
  const visibleKinds = NOTIFICATION_KINDS.filter((k) => !("feature" in k) || featureOn.has(k.feature as FeatureKey)).map(
    (k) => k.id
  );
  const webPushPublicKey = browserFlag.has(identity.memberId) ? (vapidKeys()?.publicKey ?? null) : null;
  const channels = NOTIFICATION_CHANNELS.map((c) => c.id).filter(
    (id) => id !== "web_push" || webPushPublicKey !== null
  );

  return {
    channels,
    webPushPublicKey,
    channelsByKind: effectiveSettings(stored),
    visibleKinds,
    readOnly: identity.isSudo,
  };
}

/**
 * Turn one kind of notification on or off for one channel. Stores the choice even when it matches
 * today's default, so it sticks if the default changes. Refused in sudo (RLS also keeps writes
 * owner-only).
 */
async function setNotificationChannelImpl(
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
  try {
    await createRepos(supabase).notifications.setPreference(identity.memberId, kind, channel, enabled);
  } catch (error) {
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
  return isAllowedPushEndpoint(endpoint);
}

/**
 * Remember this browser as a device to send Browser notifications to. Written with the service
 * role (the table holds push credentials, so members can't touch it directly), after checking who's
 * asking. Subscribing the same browser again reuses its row and revives it if it had been removed;
 * a browser that moved to another member's account moves with it.
 */
async function savePushSubscriptionImpl(
  subscription: PushSubscriptionInput,
  userAgent: string | null
): Promise<{ success: true; memberId: string } | { error: string }> {
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

  try {
    await createRepos(service).pushSubscriptions.save({
      memberId: identity.memberId,
      endpoint: subscription.endpoint,
      p256dh: subscription.keys.p256dh,
      auth: subscription.keys.auth,
      userAgent: typeof userAgent === "string" ? userAgent.slice(0, 500) : null,
    });
  } catch (error) {
    console.error("[notifications] Saving push subscription failed", { member: identity.memberId, error });
    return { error: "Couldn't turn on notifications for this device — please try again." };
  }
  return { success: true, memberId: identity.memberId };
}

/** Stop sending Browser notifications to this device (soft delete; only the member's own subscription). */
async function removePushSubscriptionImpl(endpoint: string): Promise<{ success: true } | { error: string }> {
  const user = await getCurrentUser();
  if (!user) return { error: "Not authenticated" };
  const identity = await getEffectiveIdentity(user);
  if (!identity) return { error: "No member record" };
  if (identity.isSudo) return { error: "Notification settings can't be changed in sudo mode." };
  if (typeof endpoint !== "string" || !endpoint) return { error: "Invalid push subscription" };

  try {
    await createRepos(createServiceRoleClient()).pushSubscriptions.removeByEndpoint(identity.memberId, endpoint, new Date().toISOString());
  } catch (error) {
    console.error("[notifications] Removing push subscription failed", { member: identity.memberId, error });
    return { error: "Couldn't turn off notifications for this device — please try again." };
  }
  return { success: true };
}

/** Pause this browser while signed out; keep its consent for the same account's next sign-in. */
export async function pausePushSubscription(endpoint: string): Promise<{ success: true; memberId: string } | { error: string }> {
  const user = await getCurrentUser();
  if (!user) return { error: "Not authenticated" };
  // Sign-out is about the real account, including while an admin is browsing in sudo.
  const service = createServiceRoleClient();
  const member = await createRepos(service).members.byUserId(user.id).catch(() => null);
  if (!member) return { error: "Couldn't find your member record" };
  if (!isAllowedPushEndpoint(endpoint)) return { error: "Invalid push subscription" };
  try {
    await createRepos(service).pushSubscriptions.pause(member.id, endpoint, new Date().toISOString());
  } catch {
    return { error: "Couldn't pause notifications for this device" };
  }
  return { success: true, memberId: member.id };
}

/** Resume only this member's existing consent. Never transfer another account's device or undo an opt-out. */
export async function resumePushSubscription(
  previousEndpoint: string,
  subscription: PushSubscriptionInput
): Promise<{ success: true } | { error: string }> {
  const user = await getCurrentUser();
  if (!user) return { error: "Not authenticated" };
  const identity = await getEffectiveIdentity(user);
  if (!identity) return { error: "No member record" };
  if (identity.isSudo) return { error: "Notifications can't be resumed in sudo mode." };
  if (!isAllowedPushEndpoint(previousEndpoint) || !validSubscription(subscription)) return { error: "Invalid push subscription" };
  const service = createServiceRoleClient();
  if (!(await membersWithFeature(service, WEB_PUSH_FEATURE, [identity.memberId])).has(identity.memberId)) {
    return { error: "Browser notifications aren't available to you yet." };
  }
  let resumed: boolean;
  try {
    resumed = await createRepos(service).pushSubscriptions.resume(identity.memberId, previousEndpoint, {
      endpoint: subscription.endpoint,
      p256dh: subscription.keys.p256dh,
      auth: subscription.keys.auth,
    });
  } catch {
    return { error: "Couldn't resume notifications for this device" };
  }
  if (!resumed) return { error: "This device needs a new opt-in" };
  return { success: true };
}

export interface PushDeviceRow {
  id: string;
  label: string;
  addedAt: string;
  lastSentAt: string | null;
  /** The browser asking: its endpoint matches this subscription. */
  isThisDevice: boolean;
  paused?: boolean;
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
      ...(d.pausedAt ? { paused: true } : {}),
    }));
  } catch (error) {
    console.error("[notifications] Loading push devices failed", { member: identity.memberId, error });
    // A failed ownership lookup must never look like an unowned browser to the account guard.
    throw new Error("Couldn't load browser notification devices");
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

  try {
    await createRepos(createServiceRoleClient()).pushSubscriptions.removeById(identity.memberId, id, new Date().toISOString());
  } catch (error) {
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

// Usage analytics: each action records whether it worked (lib/analytics/server.ts).
export async function setNotificationChannel(...args: Parameters<typeof setNotificationChannelImpl>): ReturnType<typeof setNotificationChannelImpl> {
  return withAction("notification_setting_changed", () => setNotificationChannelImpl(...args));
}

export async function savePushSubscription(...args: Parameters<typeof savePushSubscriptionImpl>): ReturnType<typeof savePushSubscriptionImpl> {
  return withAction("push_enabled", () => savePushSubscriptionImpl(...args));
}

export async function removePushSubscription(...args: Parameters<typeof removePushSubscriptionImpl>): ReturnType<typeof removePushSubscriptionImpl> {
  return withAction("push_disabled", () => removePushSubscriptionImpl(...args));
}
