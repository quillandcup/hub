"use server";

import { requireAdminAction } from "@/lib/admin-auth";
import { isChannelId } from "@/lib/channels";
import { sendDiagnosticPush as sendPush } from "@/lib/channels/web-push";
import { sendTestNotification as sendTest } from "@/lib/notification-test";
import { isNotificationKind } from "@/lib/notifications/registry";
import { getEffectiveIdentity } from "@/lib/sudo";
import { createServiceRoleClient } from "@/lib/supabase/service";

/** Real pushes for the click diagnostics; each differs from the one before by one field. */
const DIAGNOSTIC_PUSHES = {
  persistent: { tag: undefined, urgency: "normal", ttlSeconds: 24 * 60 * 60 },
  tagged: { tag: "prickle_checkin:diagnostic", urgency: "normal", ttlSeconds: 24 * 60 * 60 },
  tagged_urgent: { tag: "prickle_checkin:diagnostic", urgency: "high", ttlSeconds: 15 * 60 },
} as const;

/**
 * Sends the admin's own devices a real Web Push (server -> push service -> the worker's push event),
 * unlike the in-page comparison alerts. Same destination and flags as a check-in, one option at a time.
 */
export async function sendDiagnosticPush(variant: string) {
  const auth = await requireAdminAction();
  if (!auth.ok) return { error: auth.error };
  if (!Object.hasOwn(DIAGNOSTIC_PUSHES, variant)) return { error: "Unknown push variant" };
  const { tag, urgency, ttlSeconds } = DIAGNOSTIC_PUSHES[variant as keyof typeof DIAGNOSTIC_PUSHES];

  const identity = await getEffectiveIdentity(auth.user);
  if (!identity) return { error: "Your account has no member record to send to." };
  if (identity.isSudo) return { error: "Exit sudo first: test sends go to your own accounts." };

  try {
    const sent = await sendPush(
      createServiceRoleClient(),
      identity.memberId,
      { title: `[Test] ${variant} server push`, body: "Click to test whether the browser delivers this server push to the Hub.", url: "/admin/notifications", tag, requireInteraction: true },
      { urgency, ttlSeconds }
    );
    return { success: true as const, sent };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

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
