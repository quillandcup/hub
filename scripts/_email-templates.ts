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
const OTP_CODE = "{{ .Token }}";

/**
 * The link in the invite, recovery and sign-in emails: our /auth/confirm route with the hashed one-time token
 * (src/app/auth/confirm/route.ts), not Supabase's own verify address. {{ .RedirectTo }} is the address the request
 * asked to come back to; the code passes `${APP_URL}/auth/confirm` (a bare address, the token is appended here) and
 * the allow-list in supabase/config.toml lists it. A request that named no address falls back to the site URL
 * (/auth/callback), which hands the token on to /auth/confirm. Not used for email_change, which still goes through
 * Supabase's address.
 */
const confirmLink = (type: "email" | "invite" | "recovery") =>
  `{{ .RedirectTo }}?token_hash={{ .TokenHash }}&type=${type}`;

export type EmailTemplate = { name: string; subject: string; html: string };

export async function buildTemplates(): Promise<EmailTemplate[]> {
  return [
    {
      name: "invite",
      subject: "You're invited to join Hedgie Hub",
      html: await render(React.createElement(InviteEmail, { confirmationUrl: confirmLink("invite") })),
    },
    {
      name: "confirmation",
      subject: "Confirm your email – Hedgie Hub",
      html: await render(React.createElement(ConfirmationEmail, { confirmationUrl: CONFIRMATION_URL })),
    },
    {
      name: "recovery",
      subject: "Reset your Hedgie Hub password",
      html: await render(React.createElement(RecoveryEmail, { confirmationUrl: confirmLink("recovery") })),
    },
    {
      name: "magic_link",
      subject: "Hedgie Hub – {{ .Token }} is your verification code",
      html: await render(React.createElement(MagicLinkEmail, { confirmationUrl: confirmLink("email"), code: OTP_CODE })),
    },
    {
      name: "email_change",
      subject: "Confirm your new email – Hedgie Hub",
      html: await render(
        React.createElement(EmailChangeEmail, { confirmationUrl: CONFIRMATION_URL, newEmail: NEW_EMAIL })
      ),
    },
  ];
}
