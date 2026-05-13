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

export function InviteEmail({ confirmationUrl }: { confirmationUrl: string }) {
  return (
    <EmailLayout preview="You've been invited to join Quill & Cup">
      <EmailHeading>You've been invited to join our prickle.</EmailHeading>

      <EmailBody>
        Someone at Quill &amp; Cup has set a place at the table for you. We're a
        community of writers who gather, write, and linger — one prickle at a time.
      </EmailBody>

      <EmailBody>
        Click below to accept your invitation and set up your account. This link
        expires in 24 hours.
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
        Accept your invitation
      </Button>

      <EmailDivider />

      <EmailMuted>
        If you weren't expecting this invitation or something feels off, you can
        safely ignore this email — no account will be created.
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

export default InviteEmail;
