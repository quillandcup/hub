import * as React from "react";
import { Button, Text } from "react-email";
import {
  EmailLayout,
  EmailHeading,
  EmailBody,
  EmailDivider,
  EmailMuted,
  EmailCode,
  colors,
  fonts,
} from "../../supabase/emails/layout";

/**
 * The one-off "Hedgie Hub is open" email. Carries the member's own sign-in code, so signing in
 * needs no second email, and a button to the page that takes the code. The code is not in the
 * link: opening a link (a mail scanner, a preview) must not spend anything.
 */
export function LaunchEmail({ code, signInUrl }: { code: string; signInUrl: string }) {
  return (
    <EmailLayout preview={`${code} is your verification code.`}>
      <EmailHeading>Hedgie Hub is open.</EmailHeading>

      <EmailBody>
        Your account is ready. To sign in, open the page below, enter this email address, and enter your verification code:
      </EmailBody>

      <EmailCode>{code}</EmailCode>

      <Button
        href={signInUrl}
        style={{
          display: "block",
          width: "fit-content",
          margin: "32px auto",
          backgroundColor: colors.headingText,
          color: "#ffffff",
          padding: "14px 36px",
          borderRadius: "4px",
          fontSize: "15px",
          fontFamily: fonts.serif,
          letterSpacing: "0.03em",
          textDecoration: "none",
        }}
      >
        Sign in to Hedgie Hub
      </Button>

      <EmailBody>
        The code works once and expires in 24 hours. After that, or if it doesn't work, ask for a new sign-in link on
        the same page and we'll email you one.
      </EmailBody>

      <EmailDivider />

      <EmailMuted>
        If you weren't expecting this, you can ignore it; nothing happens until the code is used.
      </EmailMuted>

      <Text style={{ fontSize: "13px", color: colors.mutedText, textAlign: "center", margin: "16px 0 0 0" }}>
        Button not working? Copy and paste this link into your browser:{" "}
        <a href={signInUrl} style={{ color: colors.accent, wordBreak: "break-all" }}>
          {signInUrl}
        </a>
      </Text>
    </EmailLayout>
  );
}

export default LaunchEmail;
