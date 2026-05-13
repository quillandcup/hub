/**
 * HTML email compatibility tests using Mailpit's caniemail.com-based HTML check.
 *
 * Renders each template and POSTs it to Mailpit's HTTP API, then asserts the
 * cross-client support score meets our minimum threshold.
 *
 * Requires local Supabase to be running (mailpit on localhost:54324).
 * Skip individual tests with: vitest run --reporter=verbose tests/email/
 */

import { describe, it, expect, afterEach } from "vitest";
import { buildTemplates, type EmailTemplate } from "../../scripts/_email-templates";

const MAILPIT_API = "http://localhost:54324/api/v1";

// 80% is our floor — current templates score ~82-83%.
// Lowering this threshold requires justification; raising it is always welcome.
const MIN_SUPPORTED_PERCENT = 80;

interface MailpitSendResponse {
  ID: string;
}

interface HtmlCheckResponse {
  Total: {
    Tests: number;
    Nodes: number;
    Supported: number;
    Partial: number;
    Unsupported: number;
  };
  Warnings: Array<{
    Slug: string;
    Title: string;
    Score: unknown;
  }>;
}

async function isMailpitAvailable(): Promise<boolean> {
  try {
    const res = await fetch(`${MAILPIT_API}/info`, { signal: AbortSignal.timeout(1000) });
    return res.ok;
  } catch {
    return false;
  }
}

async function sendToMailpit(template: EmailTemplate): Promise<string> {
  const res = await fetch(`${MAILPIT_API}/send`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      From: { Email: "test@quillandcup.com", Name: "Quill & Cup" },
      To: [{ Email: "test@example.com" }],
      Subject: template.subject,
      HTML: template.html,
      Tags: ["html-compatibility-test"],
    }),
  });

  if (!res.ok) {
    throw new Error(`Mailpit send failed: ${res.status} ${await res.text()}`);
  }

  const { ID } = (await res.json()) as MailpitSendResponse;
  return ID;
}

async function getHtmlCheckScore(messageId: string): Promise<HtmlCheckResponse["Total"]> {
  const res = await fetch(`${MAILPIT_API}/message/${messageId}/html-check`);
  if (!res.ok) {
    throw new Error(`HTML check failed: ${res.status}`);
  }
  const data = (await res.json()) as HtmlCheckResponse;
  return data.Total;
}

async function deleteMessage(messageId: string): Promise<void> {
  await fetch(`${MAILPIT_API}/messages`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ IDs: [messageId] }),
  });
}

describe("email template HTML compatibility", () => {
  let sentMessageIds: string[] = [];

  afterEach(async () => {
    for (const id of sentMessageIds) {
      await deleteMessage(id);
    }
    sentMessageIds = [];
  });

  it("mailpit is available (skip remaining tests if not)", async () => {
    const available = await isMailpitAvailable();
    if (!available) {
      console.warn("Mailpit not available at localhost:54324 — skipping HTML compatibility tests");
    }
    expect(available).toBe(true);
  });

  describe("cross-client support scores", () => {
    let templates: EmailTemplate[];

    it("renders all templates", async () => {
      const available = await isMailpitAvailable();
      if (!available) return;

      templates = await buildTemplates();
      expect(templates).toHaveLength(5);
    });

    const templateNames = ["invite", "confirmation", "recovery", "magic_link", "email_change"];

    for (const name of templateNames) {
      it(`${name}: supported >= ${MIN_SUPPORTED_PERCENT}%`, async () => {
        const available = await isMailpitAvailable();
        if (!available) return;

        if (!templates) {
          templates = await buildTemplates();
        }

        const template = templates.find((t) => t.name === name);
        expect(template, `template "${name}" not found`).toBeDefined();

        const messageId = await sendToMailpit(template!);
        sentMessageIds.push(messageId);

        const score = await getHtmlCheckScore(messageId);

        console.log(
          `  ${name}: ${score.Supported.toFixed(1)}% supported, ` +
            `${score.Partial.toFixed(1)}% partial, ` +
            `${score.Unsupported.toFixed(1)}% unsupported ` +
            `(${score.Tests} tests)`
        );

        expect(
          score.Supported,
          `${name} support score ${score.Supported.toFixed(1)}% is below ${MIN_SUPPORTED_PERCENT}% threshold`
        ).toBeGreaterThanOrEqual(MIN_SUPPORTED_PERCENT);
      });
    }
  });
});
