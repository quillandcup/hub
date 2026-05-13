/**
 * Render React Email templates and sync them to a hosted Supabase project
 * via the Management API. Also writes rendered HTML to supabase/templates/
 * so local Supabase (config.toml) stays in sync.
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

import { writeFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { config } from "dotenv";
import { buildTemplates } from "./_email-templates";

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

(async () => {
  const templates = await buildTemplates();

  console.log("Writing rendered HTML to supabase/templates/...");
  for (const t of templates) {
    writeFileSync(resolve(templatesDir, `${t.name}.html`), t.html);
  }

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
