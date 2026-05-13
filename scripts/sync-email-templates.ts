/**
 * Sync Supabase auth email templates to a hosted project via the Management API.
 *
 * Requires two env vars not needed by the app itself:
 *   SUPABASE_PROJECT_REF   — project reference (e.g. "abcxyzabcxyz")
 *   SUPABASE_ACCESS_TOKEN  — personal access token from
 *                            https://supabase.com/dashboard/account/tokens
 *
 * Usage:
 *   npx tsx scripts/sync-email-templates.ts [env-file]
 *
 * Examples:
 *   npx tsx scripts/sync-email-templates.ts .env.prod
 *   npx tsx scripts/sync-email-templates.ts .env.devel
 */

import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { config } from "dotenv";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, "..");

const [envFile] = process.argv.slice(2);
if (!envFile) {
  console.error("Usage: npx tsx scripts/sync-email-templates.ts <env-file>\n\nExample: npx tsx scripts/sync-email-templates.ts .env.prod");
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

function readTemplate(name: string): string {
  const path = resolve(projectRoot, "supabase", "templates", `${name}.html`);
  return readFileSync(path, "utf-8");
}

const payload = {
  mailer_subjects_invite: "You're invited to join Quill & Cup",
  mailer_templates_invite_content: readTemplate("invite"),

  mailer_subjects_confirmation: "Confirm your email – Quill & Cup",
  mailer_templates_confirmation_content: readTemplate("confirmation"),

  mailer_subjects_recovery: "Reset your Quill & Cup password",
  mailer_templates_recovery_content: readTemplate("recovery"),

  mailer_subjects_magic_link: "Your Quill & Cup sign-in link",
  mailer_templates_magic_link_content: readTemplate("magic_link"),

  mailer_subjects_email_change: "Confirm your new email – Quill & Cup",
  mailer_templates_email_change_content: readTemplate("email_change"),
};

console.log(`Syncing ${Object.keys(payload).length / 2} email templates to project: ${PROJECT_REF}`);

(async () => {
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
  console.log("View them at: https://supabase.com/dashboard/project/" + PROJECT_REF + "/auth/templates");
})();
