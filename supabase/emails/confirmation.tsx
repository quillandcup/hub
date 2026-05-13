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

export function ConfirmationEmail({ confirmationUrl }: { confirmationUrl: string }) {
  return (
    <EmailLayout preview="One quick step before you settle in.">
      <EmailHeading>One quick step before you settle in.</EmailHeading>

      <EmailBody>
        Thanks for joining Quill &amp; Cup. Please confirm your email address so
        we can make sure your seat is reserved.
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
        Confirm my email
      </Button>

      <EmailDivider />

      <EmailMuted>
        If you didn't create an account with us, you can safely ignore this message.
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

export default ConfirmationEmail;
