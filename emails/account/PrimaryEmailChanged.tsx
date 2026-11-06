import * as React from "react";
import { EmailLayout, EmailHeading, EmailBody, EmailDivider, EmailMuted } from "../../supabase/emails/layout";

/**
 * Sent to both addresses when a Hedgie Hub admin changes a member's primary email, so the change is
 * never silent: the new address learns what to sign in with, the old one learns it no longer works.
 */
export function PrimaryEmailChanged({
  previous,
  address,
  recipient,
  supportEmail,
}: {
  previous: string;
  address: string;
  /** Which address this copy goes to. */
  recipient: "new" | "old";
  supportEmail: string;
}) {
  return (
    <EmailLayout preview={`Your Hedgie Hub email is now ${address}.`}>
      <EmailHeading>Your Hedgie Hub email was changed.</EmailHeading>

      <EmailBody>
        A Hedgie Hub admin changed the email on your account from {previous} to {address}.
        {recipient === "new"
          ? ` Sign in with ${address} from now on; we'll write to you there too.`
          : ` You can no longer sign in with ${previous}; use ${address} instead.`}
      </EmailBody>

      <EmailDivider />

      <EmailMuted>
        If this wasn&apos;t expected, email {supportEmail} and we&apos;ll sort it out.
      </EmailMuted>
    </EmailLayout>
  );
}

export default PrimaryEmailChanged;
