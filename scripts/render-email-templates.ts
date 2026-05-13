/**
 * Render React Email templates to supabase/templates/ for local Supabase dev.
 * No credentials required — run this after editing templates in supabase/emails/.
 *
 * Usage:
 *   npx tsx scripts/render-email-templates.ts
 */

import { writeFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { buildTemplates } from "./_email-templates";

const __dirname = dirname(fileURLToPath(import.meta.url));
const templatesDir = resolve(__dirname, "..", "supabase", "templates");

(async () => {
  const templates = await buildTemplates();
  for (const t of templates) {
    const path = resolve(templatesDir, `${t.name}.html`);
    writeFileSync(path, t.html);
    console.log(`  wrote ${t.name}.html`);
  }
  console.log("Done. Restart Supabase to pick up the changes.");
})();
