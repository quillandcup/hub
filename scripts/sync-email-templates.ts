/**
 * Render React Email templates and sync them to a hosted Supabase project
 * via the Management API. Also writes rendered HTML back to supabase/templates/
 * for local dev (config.toml reads from there).
 *
 * Requires two env vars not needed by the app itself:
 *   SUPABASE_PROJECT_REF   — project reference (e.g. "abcxyzabcxyz")
 *   SUPABASE_ACCESS_TOKEN  — personal access token from
 *                            https://supabase.com/dashboard/account/tokens
 *
 * Usage:
 *   npx tsx scripts/sync-email-templates.ts <env-file>
 *
 * Example:
 *   npx tsx scripts/sync-email-templates.ts .env.prod
 */

import * as React from "react";
import { render } from "react-email";
import { writeFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { config } from "dotenv";

import { InviteEmail } from "../supabase/emails/invite";
import { ConfirmationEmail } from "../supabase/emails/confirmation";
import { RecoveryEmail } from "../supabase/emails/recovery";
import { MagicLinkEmail } from "../supabase/emails/magic-link";
import { EmailChangeEmail } from "../supabase/emails/email-change";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, "..");
const templatesDir = resolve(projectRoot, "supabase", "templates");

const [envFile] = process.argv.slice(2);
if (!envFile) {
  console.error(
    "Usage: npx tsx scripts/sync-email-templates.ts <env-file>\n\nExample: npx tsx scripts/sync-email-templates.ts .env.prod"
  );
  process.exit(1);
}

const envPath = resolve(projectRoot, envFile);
console.log(`Loading environment from: ${envPath}`);
const envResult = config({ path: envPath });
if (envResult.error) {
  console.error(`Failed to load ${envFile}:`, envResult.error.message);
  process.exit(1);
}

const PROJECT_REF = process.env.SUPABASE_PROJECT_REF;
const ACCESS_TOKEN = process.env.SUPABASE_ACCESS_TOKEN;

if (!PROJECT_REF || !ACCESS_TOKEN) {
  console.error(
    "Missing required env vars: SUPABASE_PROJECT_REF and SUPABASE_ACCESS_TOKEN\n" +
      "Add them to your env file or set them in your shell.\n" +
      "Get an access token at: https://supabase.com/dashboard/account/tokens"
  );
  process.exit(1);
}

// Supabase Go template variables — passed as literal strings so they survive
// rendering and are substituted at send time by Supabase's mailer.
const CONFIRMATION_URL = "{{ .ConfirmationURL }}";
const NEW_EMAIL = "{{ .NewEmail }}";

(async () => {
  const templates = [
    {
      name: "invite",
      subject: "You're invited to join Quill & Cup",
      html: await render(React.createElement(InviteEmail, { confirmationUrl: CONFIRMATION_URL })),
    },
    {
      name: "confirmation",
      subject: "Confirm your email – Quill & Cup",
      html: await render(React.createElement(ConfirmationEmail, { confirmationUrl: CONFIRMATION_URL })),
    },
    {
      name: "recovery",
      subject: "Reset your Quill & Cup password",
      html: await render(React.createElement(RecoveryEmail, { confirmationUrl: CONFIRMATION_URL })),
    },
    {
      name: "magic_link",
      subject: "Your Quill & Cup sign-in link",
      html: await render(React.createElement(MagicLinkEmail, { confirmationUrl: CONFIRMATION_URL })),
    },
    {
      name: "email_change",
      subject: "Confirm your new email – Quill & Cup",
      html: await render(
        React.createElement(EmailChangeEmail, { confirmationUrl: CONFIRMATION_URL, newEmail: NEW_EMAIL })
      ),
    },
  ];

  // Write rendered HTML to supabase/templates/ for local Supabase (config.toml)
  console.log("Writing rendered HTML to supabase/templates/...");
  for (const t of templates) {
    writeFileSync(resolve(templatesDir, `${t.name}.html`), t.html);
  }

  // Build the Management API payload
  const payload: Record<string, string> = {};
  for (const t of templates) {
    payload[`mailer_subjects_${t.name}`] = t.subject;
    payload[`mailer_templates_${t.name}_content`] = t.html;
  }

  console.log(`Syncing ${templates.length} templates to project: ${PROJECT_REF}`);

  const response = await fetch(
    `https://api.supabase.com/v1/projects/${PROJECT_REF}/config/auth`,
    {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${ACCESS_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    }
  );

  if (!response.ok) {
    const body = await response.text();
    console.error(`API error ${response.status}: ${body}`);
    process.exit(1);
  }

  console.log("Done. Templates synced successfully.");
  console.log(
    "View them at: https://supabase.com/dashboard/project/" + PROJECT_REF + "/auth/templates"
  );
})();
