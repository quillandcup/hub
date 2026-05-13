import * as React from "react";
import { render } from "react-email";
import { InviteEmail } from "../supabase/emails/invite";
import { ConfirmationEmail } from "../supabase/emails/confirmation";
import { RecoveryEmail } from "../supabase/emails/recovery";
import { MagicLinkEmail } from "../supabase/emails/magic-link";
import { EmailChangeEmail } from "../supabase/emails/email-change";

// Supabase Go template variables — substituted at send time by Supabase's mailer.
const CONFIRMATION_URL = "{{ .ConfirmationURL }}";
const NEW_EMAIL = "{{ .NewEmail }}";

export type EmailTemplate = { name: string; subject: string; html: string };

export async function buildTemplates(): Promise<EmailTemplate[]> {
  return [
    {
      name: "invite",
      subject: "You're invited to join Quill & Cup",
      html: await render(React.createElement(InviteEmail, { confirmationUrl: CONFIRMATION_URL })),
    },
    {
      name: "confirmation",
      subject: "Confirm your email – Quill & Cup",
      html: await render(React.createElement(ConfirmationEmail, { confirmationUrl: CONFIRMATION_URL })),
    },
    {
      name: "recovery",
      subject: "Reset your Quill & Cup password",
      html: await render(React.createElement(RecoveryEmail, { confirmationUrl: CONFIRMATION_URL })),
    },
    {
      name: "magic_link",
      subject: "Your Quill & Cup sign-in link",
      html: await render(React.createElement(MagicLinkEmail, { confirmationUrl: CONFIRMATION_URL })),
    },
    {
      name: "email_change",
      subject: "Confirm your new email – Quill & Cup",
      html: await render(
        React.createElement(EmailChangeEmail, { confirmationUrl: CONFIRMATION_URL, newEmail: NEW_EMAIL })
      ),
    },
  ];
}
