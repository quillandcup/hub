import { renderNotificationEmail } from "@/emails/notifications";
import { sendEmail } from "@/lib/email";
import { oneClickUnsubscribeUrl, signUnsubscribeToken, unsubscribePageUrl } from "@/lib/email-unsubscribe";
import { isNotificationKind, notificationKind } from "@/lib/notifications/registry";
import type { ChannelAdapter } from "./types";

// Keeps each `.in("id", ...)` URL well under PostgREST's length limit.
const MEMBER_ID_CHUNK = 200;

/**
 * Email from the Hub, to the address on the member's record. The body is the kind's React Email
 * template (emails/notifications/), rendered at send time. sendEmail honors EMAIL_TEST_MODE.
 *
 * Every email carries a per-kind unsubscribe: a footer link to a no-login page (/unsubscribe) and
 * the List-Unsubscribe headers that make mail clients show their own Unsubscribe button, which
 * POSTs to /api/email/unsubscribe. Both use a signed token (lib/email-unsubscribe.ts), so a send
 * fails, rather than go out without one, when EMAIL_UNSUBSCRIBE_SECRET is unset.
 */
export const emailChannel: ChannelAdapter = {
  id: "email",
  async resolveAddresses(supabase, memberIds) {
    const addresses = new Map<string, string>();
    for (let i = 0; i < memberIds.length; i += MEMBER_ID_CHUNK) {
      const { data, error } = await supabase
        .from("members")
        .select("id, email")
        .in("id", memberIds.slice(i, i + MEMBER_ID_CHUNK));
      if (error) console.error("[email] Loading member addresses failed", error);
      for (const row of data ?? []) {
        if (row.email) addresses.set(row.id, row.email);
      }
    }
    return addresses;
  },
  async send(address, message, { kind, memberId }) {
    if (!isNotificationKind(kind)) throw new Error(`No email template for notification kind "${kind}"`);
    const token = signUnsubscribeToken(memberId, kind);
    const unsubscribe = {
      label: `Unsubscribe from “${notificationKind(kind).label}” emails`,
      url: unsubscribePageUrl(token),
    };
    const { subject, html, text } = await renderNotificationEmail(kind, {
      ...message,
      footerLinks: [...(message.footerLinks ?? []), unsubscribe],
    });
    await sendEmail({
      to: address,
      subject,
      html,
      text,
      headers: {
        "List-Unsubscribe": `<${oneClickUnsubscribeUrl(token)}>`,
        "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
      },
    });
  },
};
