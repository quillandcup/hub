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

export function EmailChangeEmail({
  confirmationUrl,
  newEmail,
}: {
  confirmationUrl: string;
  newEmail: string;
}) {
  return (
    <EmailLayout preview="Confirm your new Quill & Cup email address.">
      <EmailHeading>Confirm your new email address.</EmailHeading>

      <EmailBody>
        You've requested to update the email address on your Quill &amp; Cup
        account to:
      </EmailBody>

      <Text
        style={{
          backgroundColor: "#faf8f5",
          border: `1px solid ${colors.border}`,
          borderRadius: "4px",
          padding: "12px 16px",
          fontSize: "15px",
          color: colors.headingText,
          textAlign: "center",
          margin: "0 0 20px 0",
          wordBreak: "break-all",
        }}
      >
        {newEmail}
      </Text>

      <EmailBody>
        Click below to confirm this change. Until you do, your current email
        address remains active.
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
        Confirm new email
      </Button>

      <EmailDivider />

      <EmailMuted>
        If you didn't request this change, please contact us right away — your
        account email has not been updated yet.
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

export default EmailChangeEmail;
