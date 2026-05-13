import * as React from "react";
import { Button, Text } from "react-email";
import {
  EmailLayout,
  EmailHeading,
  EmailBody,
  EmailDivider,
  EmailMuted,
  colors,
  fonts,
} from "./layout";

export function RecoveryEmail({ confirmationUrl }: { confirmationUrl: string }) {
  return (
    <EmailLayout preview="Let's get you back to the page.">
      <EmailHeading>Let's get you back to the page.</EmailHeading>

      <EmailBody>
        We received a request to reset the password for your Quill &amp; Cup
        account. Click below to choose a new one.
      </EmailBody>

      <EmailBody>
        This link is good for one hour. After that, you're welcome to request another.
      </EmailBody>

      <Button
        href={confirmationUrl}
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
        Reset my password
      </Button>

      <EmailDivider />

      <EmailMuted>
        If you didn't request a password reset, no action is needed — your account
        is safe and your password hasn't changed.
      </EmailMuted>

      <Text
        style={{ fontSize: "13px", color: colors.mutedText, textAlign: "center", margin: "16px 0 0 0" }}
      >
        Button not working? Copy and paste this link into your browser:{" "}
        <a href={confirmationUrl} style={{ color: colors.accent, wordBreak: "break-all" }}>
          {confirmationUrl}
        </a>
      </Text>
    </EmailLayout>
  );
}

export default RecoveryEmail;
