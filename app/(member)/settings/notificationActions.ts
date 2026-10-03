"use server";

import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import { getEffectiveIdentity } from "@/lib/sudo";
import {
  effectiveSettings,
  isNotificationChannel,
  isNotificationKind,
  type NotificationChannelId,
  type NotificationKindId,
} from "@/lib/notifications/registry";

export interface NotificationSettings {
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

  return { channelsByKind: effectiveSettings(data ?? []), readOnly: identity.isSudo };
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
