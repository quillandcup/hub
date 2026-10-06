"use server";

import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { getCurrentUser } from "@/lib/auth";
import { getEffectiveIdentity } from "@/lib/sudo";
import {
  BELL_LIMIT,
  countInAppNotifications,
  loadInAppNotifications,
  markAllInAppNotificationsRead,
  markInAppNotificationsRead,
  markInAppNotificationsUnread,
  type InAppNotification,
} from "@/lib/channels/in-app";

/*
 * The signed-in member's in-app notifications, for the bell and banner
 * (components/InAppNotifications.tsx) and the /notifications inbox, which reads its pages itself.
 * In sudo they're the sudo'd member's, like the rest of the member experience (reads work through
 * the admin read policy; marking read goes through the service role, since RLS only lets a member
 * mark their own). No feature-flag check: a member without the flag is never sent any
 * (lib/channels/in-app.ts), and the layout and inbox only show them to members with it.
 */

export interface BellState {
  /** The latest BELL_LIMIT, newest first. */
  latest: InAppNotification[];
  /** Across all of them, not just `latest`. */
  unreadCount: number;
}

type Result = { success: true } | { error: string };

/** The effective member's id, or why there isn't one to act for. */
async function ownMember(): Promise<{ memberId: string; isSudo: boolean } | { error: string }> {
  const user = await getCurrentUser();
  if (!user) return { error: "Not signed in" };
  const identity = await getEffectiveIdentity(user);
  if (!identity) return { error: "No member record" };
  return { memberId: identity.memberId, isSudo: identity.isSudo };
}

/** Client for marking read: the member's own session, or the service role for an admin in sudo. */
async function writer(isSudo: boolean) {
  return isSudo ? createServiceRoleClient() : await createClient();
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

function validIds(ids: unknown): ids is string[] {
  return Array.isArray(ids) && ids.length > 0 && ids.length <= 100 && ids.every((id) => typeof id === "string" && id);
}

/** Marks some read (opening one, dismissing its banner, a bulk action in the inbox). */
export async function markInAppNotificationsReadAction(ids: string[]): Promise<Result> {
  const own = await ownMember();
  if ("error" in own) return own;
  const { memberId, isSudo } = own;
  if (!validIds(ids)) return { error: "Invalid notifications" };
  const { error } = await markInAppNotificationsRead(await writer(isSudo), memberId, ids);
  if (error) {
    console.error("[in-app] Marking notifications read failed", { member: memberId, ids, error });
    return { error: "Couldn't update your notifications — please try again." };
  }
  return { success: true };
}

/** Puts some back to unread (the inbox's "Mark as unread", single or bulk). */
export async function markInAppNotificationsUnreadAction(ids: string[]): Promise<Result> {
  const own = await ownMember();
  if ("error" in own) return own;
  const { memberId, isSudo } = own;
  if (!validIds(ids)) return { error: "Invalid notifications" };
  const { error } = await markInAppNotificationsUnread(await writer(isSudo), memberId, ids);
  if (error) {
    console.error("[in-app] Marking notifications unread failed", { member: memberId, ids, error });
    return { error: "Couldn't update your notifications — please try again." };
  }
  return { success: true };
}

/** Marks every one read. */
export async function markAllInAppNotificationsReadAction(): Promise<Result> {
  const own = await ownMember();
  if ("error" in own) return own;
  const { memberId, isSudo } = own;
  const { error } = await markAllInAppNotificationsRead(await writer(isSudo), memberId);
  if (error) {
    console.error("[in-app] Marking all notifications read failed", { member: memberId, error });
    return { error: "Couldn't update your notifications — please try again." };
  }
  return { success: true };
}
