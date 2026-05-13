import * as React from "react";
import {
  Html,
  Head,
  Preview,
  Body,
  Container,
  Section,
  Text,
  Hr,
} from "react-email";

const colors = {
  bg: "#faf8f5",
  card: "#ffffff",
  border: "#e8e0d5",
  headingText: "#3d2b1f",
  bodyText: "#5a4a3a",
  mutedText: "#8a7a6a",
  footerText: "#a89880",
  accent: "#8b5e3c",
};

const fonts = {
  serif: "Georgia, 'Times New Roman', serif",
};

export function EmailLayout({
  preview,
  children,
}: {
  preview: string;
  children: React.ReactNode;
}) {
  return (
    <Html lang="en">
      <Head />
      <Preview>{preview}</Preview>
      <Body
        style={{
          margin: 0,
          padding: 0,
          backgroundColor: colors.bg,
          fontFamily: fonts.serif,
        }}
      >
        <Container style={{ maxWidth: "560px", margin: "40px auto", padding: "0 20px" }}>
          <Section
            style={{
              backgroundColor: colors.card,
              borderRadius: "8px",
              border: `1px solid ${colors.border}`,
              padding: "48px 40px",
            }}
          >
            {/* Logo */}
            <Text
              style={{
                textAlign: "center",
                fontSize: "22px",
                fontWeight: "normal",
                color: colors.headingText,
                letterSpacing: "0.04em",
                margin: "0 0 32px 0",
              }}
            >
              Quill <span style={{ color: colors.accent }}>&amp;</span> Cup
            </Text>

            {children}
          </Section>

          {/* Footer */}
          <Text
            style={{
              textAlign: "center",
              fontSize: "13px",
              color: colors.footerText,
              lineHeight: "1.6",
              margin: "32px 0 0 0",
            }}
          >
            Quill &amp; Cup · A community for writers
          </Text>
        </Container>
      </Body>
    </Html>
  );
}

export { colors, fonts };

export function EmailHeading({ children }: { children: React.ReactNode }) {
  return (
    <Text
      style={{
        fontSize: "26px",
        fontWeight: "normal",
        color: colors.headingText,
        margin: "0 0 16px 0",
        lineHeight: "1.3",
      }}
    >
      {children}
    </Text>
  );
}

export function EmailBody({ children }: { children: React.ReactNode }) {
  return (
    <Text
      style={{
        fontSize: "16px",
        lineHeight: "1.7",
        color: colors.bodyText,
        margin: "0 0 20px 0",
      }}
    >
      {children}
    </Text>
  );
}

export function EmailDivider() {
  return <Hr style={{ border: "none", borderTop: `1px solid ${colors.border}`, margin: "28px 0" }} />;
}

export function EmailMuted({ children }: { children: React.ReactNode }) {
  return (
    <Text style={{ fontSize: "14px", color: colors.mutedText, margin: "0" }}>
      {children}
    </Text>
  );
}
