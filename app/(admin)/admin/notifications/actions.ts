"use server";

import { requireAdminAction } from "@/lib/admin-auth";
import { isChannelId } from "@/lib/channels";
import { sendTestNotification as sendTest } from "@/lib/notification-test";
import { isNotificationKind } from "@/lib/notifications/registry";
import { getEffectiveIdentity } from "@/lib/sudo";
import { createServiceRoleClient } from "@/lib/supabase/service";

/**
 * Sends the signed-in admin a sample of one notification kind on one channel (see
 * lib/notification-test.ts). Always to the admin's own member record, and refused in sudo so a test
 * can't land in a member's inbox.
 */
export async function sendTestNotification(kind: string, channel: string) {
  const auth = await requireAdminAction();
  if (!auth.ok) return { error: auth.error };
  if (!isNotificationKind(kind)) return { error: "Unknown notification" };
  if (!isChannelId(channel)) return { error: "Unknown channel" };

  const identity = await getEffectiveIdentity(auth.user);
  if (!identity) return { error: "Your account has no member record to send to." };
  if (identity.isSudo) return { error: "Exit sudo first: test sends go to your own accounts." };

  // Service role, as the real sends use (the channel adapters read contact details across
  // members); every lookup is for the admin's own member id.
  const result = await sendTest(createServiceRoleClient(), identity.memberId, kind, channel);
  return result.ok ? { success: true as const, sent: result.sent } : { error: result.error };
}
