import { createHmac, timingSafeEqual } from "crypto";
import { APP_URL } from "@/lib/config";
import { isNotificationKind, type NotificationKindId } from "@/lib/notifications/registry";

/**
 * Signed links that let a member turn off one kind of notification email without signing in
 * (the footer link, and the List-Unsubscribe header that mail clients' own Unsubscribe button
 * calls). A token names one member and one kind, so it can change nothing else. It never expires:
 * an old email's unsubscribe link must keep working. Format: `<memberId>.<kind>.<hmac>`.
 */

const UNSUBSCRIBE_PATH = "/unsubscribe";
const ONE_CLICK_PATH = "/api/email/unsubscribe";

function sign(payload: string): string {
  const secret = process.env.EMAIL_UNSUBSCRIBE_SECRET;
  if (!secret) throw new Error("EMAIL_UNSUBSCRIBE_SECRET environment variable is not set");
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

export function signUnsubscribeToken(memberId: string, kind: NotificationKindId): string {
  const payload = `${memberId}.${kind}`;
  return `${payload}.${sign(payload)}`;
}

export function parseUnsubscribeToken(token: string | null | undefined): { memberId: string; kind: NotificationKindId } | null {
  if (!token || !process.env.EMAIL_UNSUBSCRIBE_SECRET) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [memberId, kind, signature] = parts;
  if (!isNotificationKind(kind)) return null;
  const expected = Buffer.from(sign(`${memberId}.${kind}`));
  const actual = Buffer.from(signature);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
  return { memberId, kind };
}

/** The page in the footer link: shows the state and lets them unsubscribe or turn it back on. */
export const unsubscribePageUrl = (token: string) => `${APP_URL}${UNSUBSCRIBE_PATH}?t=${token}`;

/** The RFC 8058 one-click endpoint named in the List-Unsubscribe header. */
export const oneClickUnsubscribeUrl = (token: string) => `${APP_URL}${ONE_CLICK_PATH}?t=${token}`;

/**
 * Stores the member's email choice for a kind, the same row the settings page writes (so it's an
 * explicit choice either way). Service-role client: the caller proved who they are with a token.
 */
export async function setEmailEnabled(
  supabase: any,
  memberId: string,
  kind: NotificationKindId,
  enabled: boolean
): Promise<boolean> {
  const { error } = await supabase
    .from("notification_preferences")
    .upsert({ member_id: memberId, kind, channel: "email", enabled }, { onConflict: "member_id,kind,channel" });
  if (error) console.error("[email] Saving unsubscribe choice failed", { member: memberId, kind, enabled, error });
  return !error;
}
