"use server";

import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import { getEffectiveIdentity } from "@/lib/sudo";
import {
  BELL_LIMIT,
  countInAppNotifications,
  loadInAppNotifications,
  markAllInAppNotificationsRead,
  markInAppNotificationsRead,
  type InAppNotification,
} from "@/lib/channels/in-app";

/*
 * The signed-in member's in-app notifications, for the bell and banner
 * (components/InAppNotifications.tsx) and the /notifications inbox, which reads its pages itself. Nothing in sudo: they're the member's own, and reading them isn't the
 * admin's call. No feature-flag check: a member without the flag is never sent any
 * (lib/channels/in-app.ts), and the layout and inbox only show them to members with it.
 */

export interface BellState {
  /** The latest BELL_LIMIT, newest first. */
  latest: InAppNotification[];
  /** Across all of them, not just `latest`. */
  unreadCount: number;
}

type Result = { success: true } | { error: string };

/** The signed-in member's id, or why there isn't one to act for. */
async function ownMember(): Promise<{ memberId: string } | { error: string }> {
  const user = await getCurrentUser();
  if (!user) return { error: "Not signed in" };
  const identity = await getEffectiveIdentity(user);
  if (!identity) return { error: "No member record" };
  if (identity.isSudo) return { error: "Notifications can't be changed in sudo mode." };
  return { memberId: identity.memberId };
}

/** What the bell and banner show (polled). */
export async function getMyBellState(): Promise<BellState> {
  const own = await ownMember();
  if ("error" in own) return { latest: [], unreadCount: 0 };
  const { memberId } = own;
  const supabase = await createClient();
  const [latest, unreadCount] = await Promise.all([
    loadInAppNotifications(supabase, memberId, new Date(), { limit: BELL_LIMIT }),
    countInAppNotifications(supabase, memberId, { unreadOnly: true }),
  ]);
  return { latest, unreadCount };
}

/** Marks some read (opening one, dismissing its banner). Refused in sudo (RLS also keeps it owner-only). */
export async function markInAppNotificationsReadAction(ids: string[]): Promise<Result> {
  const own = await ownMember();
  if ("error" in own) return own;
  const { memberId } = own;
  if (!Array.isArray(ids) || ids.length === 0 || ids.length > 100 || !ids.every((id) => typeof id === "string" && id)) {
    return { error: "Invalid notifications" };
  }
  const { error } = await markInAppNotificationsRead(await createClient(), memberId, ids);
  if (error) {
    console.error("[in-app] Marking notifications read failed", { member: memberId, ids, error });
    return { error: "Couldn't update your notifications — please try again." };
  }
  return { success: true };
}

/** Marks every one read. Refused in sudo. */
export async function markAllInAppNotificationsReadAction(): Promise<Result> {
  const own = await ownMember();
  if ("error" in own) return own;
  const { memberId } = own;
  const { error } = await markAllInAppNotificationsRead(await createClient(), memberId);
  if (error) {
    console.error("[in-app] Marking all notifications read failed", { member: memberId, error });
    return { error: "Couldn't update your notifications — please try again." };
  }
  return { success: true };
}
