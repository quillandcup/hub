/**
 * HTML email compatibility tests using Mailpit's caniemail.com-based HTML check.
 *
 * Two suites:
 *   1. All clients  — broad floor (80%) covering all 19 client families in the dataset
 *   2. Top 5 clients — tighter floor (90%) covering Apple Mail, Gmail, Outlook,
 *      Samsung Email, and Yahoo, which together account for ~85% of real-world opens
 *      (Litmus 2024 data). Current templates score ~96% on this subset.
 *
 * Scoring for the top-5 suite: features not flagged as warnings are assumed fully
 * supported. For warnings, results are filtered to the top-5 families and support
 * is counted as yes=1, partial=0.5, no=0 across all tested client versions.
 *
 * Requires local Supabase to be running (mailpit on localhost:54324).
 */

import { describe, it, expect, afterEach } from "vitest";
import { buildTemplates, type EmailTemplate } from "../../scripts/_email-templates";

const MAILPIT_API = "http://localhost:54324/api/v1";

// Suite 1: all clients. Current scores: 81–83%.
const MIN_ALL_CLIENTS_PERCENT = 80;

// Suite 2: top-5 clients by market share. Current scores: ~96%.
const MIN_TOP5_CLIENTS_PERCENT = 90;

// Apple Mail, Gmail, Outlook, Samsung Email, Yahoo — ~85% of email opens (Litmus 2024).
const TOP_5_FAMILIES = new Set(["apple-mail", "gmail", "outlook", "samsung-email", "yahoo"]);

interface MailpitSendResponse {
  ID: string;
}

interface HtmlCheckWarning {
  Slug: string;
  Title: string;
  Score: unknown;
  Results: Array<{
    Family: string;
    Platform: string;
    Version: string;
    Support: "yes" | "partial" | "no" | string;
  }>;
}

interface HtmlCheckResponse {
  Total: {
    Tests: number;
    Nodes: number;
    Supported: number;
    Partial: number;
    Unsupported: number;
  };
  Warnings: HtmlCheckWarning[];
}

/**
 * Computes a support score filtered to a specific set of client families.
 * Features absent from Warnings are assumed fully supported by all clients.
 */
function computeFilteredScore(
  warnings: HtmlCheckWarning[],
  totalTests: number,
  families: Set<string>
): number {
  if (warnings.length === 0) return 100;

  // Use the first warning to determine how many client versions exist for these families.
  const clientVersionsInFirstWarning = warnings[0].Results.filter((r) =>
    families.has(r.Family)
  ).length;
  if (clientVersionsInFirstWarning === 0) return 100;

  const nonWarningTests = totalTests - warnings.length;
  let totalYes = nonWarningTests * clientVersionsInFirstWarning; // assumed fully supported

  for (const warning of warnings) {
    for (const result of warning.Results) {
      if (!families.has(result.Family)) continue;
      if (result.Support === "yes") totalYes += 1;
      else if (result.Support === "partial") totalYes += 0.5;
    }
  }

  return (totalYes / (totalTests * clientVersionsInFirstWarning)) * 100;
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

async function getHtmlCheck(messageId: string): Promise<HtmlCheckResponse> {
  const res = await fetch(`${MAILPIT_API}/message/${messageId}/html-check`);
  if (!res.ok) {
    throw new Error(`HTML check failed: ${res.status}`);
  }
  return (await res.json()) as HtmlCheckResponse;
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
      it(`${name}: all clients >= ${MIN_ALL_CLIENTS_PERCENT}%`, async () => {
        const available = await isMailpitAvailable();
        if (!available) return;

        if (!templates) templates = await buildTemplates();

        const template = templates.find((t) => t.name === name);
        expect(template, `template "${name}" not found`).toBeDefined();

        const messageId = await sendToMailpit(template!);
        sentMessageIds.push(messageId);

        const { Total } = await getHtmlCheck(messageId);

        console.log(
          `  ${name} (all): ${Total.Supported.toFixed(1)}% supported, ` +
            `${Total.Partial.toFixed(1)}% partial, ` +
            `${Total.Unsupported.toFixed(1)}% unsupported (${Total.Tests} tests)`
        );

        expect(
          Total.Supported,
          `${name} all-client score ${Total.Supported.toFixed(1)}% is below ${MIN_ALL_CLIENTS_PERCENT}%`
        ).toBeGreaterThanOrEqual(MIN_ALL_CLIENTS_PERCENT);
      });
    }
  });

  describe("top-5 client support scores (Apple Mail, Gmail, Outlook, Samsung, Yahoo)", () => {
    let templates: EmailTemplate[];

    it("renders all templates", async () => {
      const available = await isMailpitAvailable();
      if (!available) return;
      templates = await buildTemplates();
      expect(templates).toHaveLength(5);
    });

    const templateNames = ["invite", "confirmation", "recovery", "magic_link", "email_change"];

    for (const name of templateNames) {
      it(`${name}: top-5 clients >= ${MIN_TOP5_CLIENTS_PERCENT}%`, async () => {
        const available = await isMailpitAvailable();
        if (!available) return;

        if (!templates) templates = await buildTemplates();

        const template = templates.find((t) => t.name === name);
        expect(template, `template "${name}" not found`).toBeDefined();

        const messageId = await sendToMailpit(template!);
        sentMessageIds.push(messageId);

        const { Total, Warnings } = await getHtmlCheck(messageId);
        const filteredScore = computeFilteredScore(Warnings, Total.Tests, TOP_5_FAMILIES);

        console.log(
          `  ${name} (top-5): ${filteredScore.toFixed(1)}% vs ${Total.Supported.toFixed(1)}% all-clients`
        );

        expect(
          filteredScore,
          `${name} top-5 score ${filteredScore.toFixed(1)}% is below ${MIN_TOP5_CLIENTS_PERCENT}%`
        ).toBeGreaterThanOrEqual(MIN_TOP5_CLIENTS_PERCENT);
      });
    }
  });
});
