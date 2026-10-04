"use server";

import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import { getEffectiveIdentity } from "@/lib/sudo";
import { loadActiveInAppNotifications, type InAppNotification } from "@/lib/channels/in-app";

/**
 * The signed-in member's banners (components/InAppNotificationBanner.tsx polls this). None in
 * sudo: they're the member's own, and dismissing them isn't the admin's call. No feature-flag
 * check: a member without the flag is never sent any (lib/channels/in-app.ts), and the layout
 * only mounts the banner for members with it.
 */
export async function getMyInAppNotifications(): Promise<InAppNotification[]> {
  const user = await getCurrentUser();
  if (!user) return [];
  const identity = await getEffectiveIdentity(user);
  if (!identity || identity.isSudo) return [];
  return loadActiveInAppNotifications(await createClient(), identity.memberId, new Date());
}

/** Dismisses one of the signed-in member's banners. Refused in sudo (RLS also keeps it owner-only). */
export async function dismissInAppNotification(id: string): Promise<{ success: true } | { error: string }> {
  const user = await getCurrentUser();
  if (!user) return { error: "Not signed in" };
  const identity = await getEffectiveIdentity(user);
  if (!identity) return { error: "No member record" };
  if (identity.isSudo) return { error: "Notifications can't be dismissed in sudo mode." };
  if (typeof id !== "string" || !id) return { error: "Invalid notification" };

  const supabase = await createClient();
  const { error } = await supabase
    .from("in_app_notifications")
    .update({ dismissed_at: new Date().toISOString() })
    .eq("id", id)
    .eq("member_id", identity.memberId);
  if (error) {
    console.error("[in-app] Dismissing notification failed", { member: identity.memberId, id, error });
    return { error: "Couldn't dismiss that — please try again." };
  }
  return { success: true };
}
