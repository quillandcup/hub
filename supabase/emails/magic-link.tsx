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
} from "./layout";

/** Subject: "<code> is your Hedgie Hub verification code" (config.toml, scripts/_email-templates.ts). */
export function MagicLinkEmail({ confirmationUrl, code }: { confirmationUrl: string; code: string }) {
  return (
    <EmailLayout preview={`${code} is your Hedgie Hub verification code.`}>
      <EmailHeading>Your verification code</EmailHeading>

      <EmailBody>Your code is:</EmailBody>

      <EmailCode>{code}</EmailCode>

      <EmailBody>Enter this code on the sign-in page. It expires in 24 hours and works once.</EmailBody>

      <EmailBody>Or sign in with one click on this device:</EmailBody>

      <Button
        href={confirmationUrl}
        style={{
          display: "block",
          width: "fit-content",
          margin: "16px auto 32px auto",
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

      <EmailDivider />

      <EmailMuted>
        If you didn't request this, you can safely ignore this email — your
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
