import { createRepos } from "@/lib/data/repos";
import { renderNotificationEmail } from "@/emails/notifications";
import { sendEmail } from "@/lib/email";
import { oneClickUnsubscribeUrl, signUnsubscribeToken, unsubscribePageUrl } from "@/lib/email-unsubscribe";
import { isNotificationKind, notificationKind } from "@/lib/notifications/registry";
import type { ChannelAdapter } from "./types";

// Keeps each `.in("id", ...)` URL well under PostgREST's length limit.

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
    try {
      for (const member of await createRepos(supabase).members.byIds(memberIds)) {
        if (member.email) addresses.set(member.id, member.email);
      }
    } catch (error) {
      console.error("[email] Loading member addresses failed", error);
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
