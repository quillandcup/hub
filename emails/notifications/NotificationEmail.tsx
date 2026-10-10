import * as React from "react";
import { Button, Text } from "react-email";
import {
  EmailLayout,
  EmailHeading,
  EmailBody,
  EmailDivider,
  colors,
  fonts,
} from "../../supabase/emails/layout";

/** What the app handed the email channel (OutboundMessage), as a template sees it. */
export interface NotificationEmailProps {
  /** The message text; also the subject. */
  text: string;
  /** Where to act on it in the Hub. */
  url?: string;
  footerLinks?: { label: string; url: string }[];
}

/**
 * The shared frame of a notification email: the message as the heading, a short explanation, and a
 * button into the Hub. A kind's template (one file per kind in this folder) supplies the wording.
 */
export function NotificationEmail({
  text,
  url,
  footerLinks,
  intro,
  buttonLabel,
}: NotificationEmailProps & {
  /** One or two sentences under the heading. */
  intro: string;
  buttonLabel: string;
}) {
  return (
    <EmailLayout preview={text} footerLinks={footerLinks}>
      <EmailHeading>{text}</EmailHeading>

      <EmailBody>{intro}</EmailBody>

      {url && (
        <>
          <Button
            href={url}
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
            {buttonLabel}
          </Button>

          <EmailDivider />

          <Text style={{ fontSize: "13px", color: colors.mutedText, textAlign: "center", margin: "0" }}>
            Button not working? Copy and paste this link into your browser:{" "}
            <a href={url} style={{ color: colors.accent, wordBreak: "break-all" }}>
              {url}
            </a>
          </Text>
        </>
      )}
    </EmailLayout>
  );
}
