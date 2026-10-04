"use server";

import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import { getEffectiveIdentity } from "@/lib/sudo";
import { loadInAppNotifications, markInAppNotificationsRead, type InAppNotification } from "@/lib/channels/in-app";

/**
 * The signed-in member's in-app notifications (components/InAppNotifications.tsx polls this).
 * None in sudo: they're the member's own, and reading them isn't the admin's call. No feature-flag
 * check: a member without the flag is never sent any (lib/channels/in-app.ts), and the layout only
 * mounts the bell and banner for members with it.
 */
export async function getMyInAppNotifications(): Promise<InAppNotification[]> {
  const user = await getCurrentUser();
  if (!user) return [];
  const identity = await getEffectiveIdentity(user);
  if (!identity || identity.isSudo) return [];
  return loadInAppNotifications(await createClient(), identity.memberId, new Date());
}

/**
 * Marks some of the signed-in member's notifications read (dismissing a banner, opening the bell).
 * Refused in sudo (RLS also keeps it owner-only).
 */
export async function markInAppNotificationsReadAction(ids: string[]): Promise<{ success: true } | { error: string }> {
  const user = await getCurrentUser();
  if (!user) return { error: "Not signed in" };
  const identity = await getEffectiveIdentity(user);
  if (!identity) return { error: "No member record" };
  if (identity.isSudo) return { error: "Notifications can't be changed in sudo mode." };
  if (!Array.isArray(ids) || ids.length === 0 || ids.length > 100 || !ids.every((id) => typeof id === "string" && id)) {
    return { error: "Invalid notifications" };
  }

  const { error } = await markInAppNotificationsRead(await createClient(), identity.memberId, ids);
  if (error) {
    console.error("[in-app] Marking notifications read failed", { member: identity.memberId, ids, error });
    return { error: "Couldn't update your notifications — please try again." };
  }
  return { success: true };
}
