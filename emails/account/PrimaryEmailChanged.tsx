import * as React from "react";
import { EmailLayout, EmailHeading, EmailBody, EmailDivider, EmailMuted } from "../../supabase/emails/layout";

/**
 * Sent to both addresses when a member's primary email changes (an admin changed it, or the member did
 * from their settings), so the change is never silent: the new address learns what to sign in with, the
 * old one learns it no longer works. When the member did it themselves, the old address is also the one
 * place the real owner would see someone else using their signed-in session.
 */
export function PrimaryEmailChanged({
  previous,
  address,
  recipient,
  by,
  supportEmail,
}: {
  previous: string;
  address: string;
  /** Which address this copy goes to. */
  recipient: "new" | "old";
  /** Who made the change. */
  by: "admin" | "member";
  supportEmail: string;
}) {
  return (
    <EmailLayout preview={`Your Hedgie Hub email is now ${address}.`}>
      <EmailHeading>Your Hedgie Hub email was changed.</EmailHeading>

      <EmailBody>
        {by === "admin"
          ? `A Hedgie Hub admin changed the email on your account from ${previous} to ${address}.`
          : `The email on your Hedgie Hub account was changed from ${previous} to ${address} from a signed-in session.`}
        {recipient === "new"
          ? ` Sign in with ${address} from now on; we'll write to you there too.`
          : ` You can no longer sign in with ${previous}; use ${address} instead.`}
      </EmailBody>

      <EmailDivider />

      <EmailMuted>
        {by === "admin"
          ? `If this wasn't expected, email ${supportEmail} and we'll sort it out.`
          : `If you didn't do this, email ${supportEmail} right away: someone else may have access to your account.`}
      </EmailMuted>
    </EmailLayout>
  );
}

export default PrimaryEmailChanged;
