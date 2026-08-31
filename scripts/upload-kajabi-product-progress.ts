#!/usr/bin/env tsx

/**
 * Uploads a downloaded Kajabi Product Progress export (see
 * scripts/kajabi-export.ts) to /api/import/kajabi-product-progress.
 *
 * Authenticates the same way internal/server-to-server calls do elsewhere in
 * this repo (lib/supabase/api-auth.ts requireAdmin): a Bearer token of the
 * Supabase service role key.
 */

import { config } from "dotenv";
import { readFileSync, existsSync } from "fs";
import path from "path";

config({ path: ".env.local" });

const APP_URL = process.env.APP_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const EXPORT_PATH =
  process.env.KAJABI_EXPORT_PATH || path.join(process.env.KAJABI_EXPORT_DIR || "downloads", "kajabi-product-progress.xlsx");

async function main() {
  if (!APP_URL) {
    console.error("Error: APP_URL environment variable is required");
    process.exit(1);
  }
  if (!SUPABASE_SERVICE_ROLE_KEY) {
    console.error("Error: SUPABASE_SERVICE_ROLE_KEY environment variable is required");
    process.exit(1);
  }
  if (!existsSync(EXPORT_PATH)) {
    console.error(`Error: export file not found at ${EXPORT_PATH}. Run kajabi:export first.`);
    process.exit(1);
  }

  const fileBuffer = readFileSync(EXPORT_PATH);
  const file = new File([fileBuffer], "kajabi-product-progress.xlsx", {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });

  const formData = new FormData();
  formData.append("file", file);

  const url = `${APP_URL.replace(/\/$/, "")}/api/import/kajabi-product-progress`;
  console.log(`Uploading ${EXPORT_PATH} to ${url}...`);

  const response = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` },
    body: formData,
  });

  const result = await response.json();

  if (!response.ok) {
    console.error(`Upload failed (${response.status}):`, result.error || result);
    process.exit(1);
  }

  console.log(`Uploaded ${result.imported} rows (importTimestamp: ${result.importTimestamp})`);
  console.log("Product breakdown:", result.productBreakdown);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
