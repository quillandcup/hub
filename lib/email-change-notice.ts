import * as React from "react";
import { render } from "react-email";
import { PrimaryEmailChanged } from "@/emails/account/PrimaryEmailChanged";
import { SUPPORT_EMAIL } from "@/lib/config";
import { sendEmail } from "@/lib/email";

export const EMAIL_CHANGED_SUBJECT = "Your Hedgie Hub email was changed";

/**
 * Tells both the new and the old address that a member's primary email changed (by an admin, or by the
 * member from their settings), so the change is never silent. A security notice about the account, not a notification kind: it must reach the old
 * address too, which the notifier (it writes to `members.email`) never does, so it is sent directly,
 * like the alias verification link. A failed send is logged and never undoes the change.
 */
export async function sendPrimaryEmailChangedNotice(memberId: string, previous: string, address: string, by: "admin" | "member"): Promise<void> {
  await Promise.all(
    (["new", "old"] as const).map(async (recipient) => {
      try {
        const element = React.createElement(PrimaryEmailChanged, { previous, address, recipient, by, supportEmail: SUPPORT_EMAIL });
        const [html, text] = await Promise.all([render(element), render(element, { plainText: true })]);
        await sendEmail({
          to: recipient === "new" ? address : previous,
          subject: EMAIL_CHANGED_SUBJECT,
          html,
          text,
          tags: { kind: "email_changed", member: memberId },
        });
      } catch (error) {
        console.error(`[email-change] Notice to the ${recipient} address failed:`, error);
      }
    })
  );
}
