import * as React from "react";
import { Button, Text } from "react-email";
import { EmailLayout, EmailHeading, EmailBody, EmailDivider, EmailMuted, colors, fonts } from "../../supabase/emails/layout";

/**
 * Sent to an address a member added to their account, to prove it is theirs. Opening the link only
 * shows a page; the button on it confirms (a mail scanner opening the link must not).
 */
export function VerifyEmail({ address, verifyUrl }: { address: string; verifyUrl: string }) {
  return (
    <EmailLayout preview={`Confirm ${address} for your Hedgie Hub account.`}>
      <EmailHeading>Is this your email address?</EmailHeading>

      <EmailBody>
        Someone added {address} to a Hedgie Hub account. If that was you, confirm it below. Once it is confirmed, you can
        switch to it as your primary email in your identity settings.
      </EmailBody>

      <Button
        href={verifyUrl}
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
        Confirm this address
      </Button>

      <EmailBody>The link works for 7 days. After that, ask for a new one in your identity settings.</EmailBody>

      <EmailDivider />

      <EmailMuted>If you didn&apos;t add this address, you can ignore this email; nothing changes until it is confirmed.</EmailMuted>

      <Text style={{ fontSize: "13px", color: colors.mutedText, textAlign: "center", margin: "16px 0 0 0" }}>
        Button not working? Copy and paste this link into your browser:{" "}
        <a href={verifyUrl} style={{ color: colors.accent, wordBreak: "break-all" }}>
          {verifyUrl}
        </a>
      </Text>
    </EmailLayout>
  );
}

export default VerifyEmail;
