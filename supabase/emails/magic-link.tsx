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

export function MagicLinkEmail({ confirmationUrl }: { confirmationUrl: string }) {
  return (
    <EmailLayout preview="Your Quill & Cup sign-in link is ready.">
      <EmailHeading>Your sign-in link is ready.</EmailHeading>

      <EmailBody>
        Here's the link you requested to sign in to Quill &amp; Cup. Click below
        to continue — no password needed.
      </EmailBody>

      <EmailBody>
        This link expires in one hour and can only be used once.
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
        Sign in to Quill &amp; Cup
      </Button>

      <EmailDivider />

      <EmailMuted>
        If you didn't request this link, you can safely ignore this email — your
        account hasn't been affected.
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

export default MagicLinkEmail;
