/**
 * One-time script to add a member email alias
 * Run after identifying a member with two email addresses
 *
 * Usage:
 *   npx tsx scripts/add-email-alias.ts <canonical_email> <alias_email> [env-file]
 *
 * Example:
 *   npx tsx scripts/add-email-alias.ts primary@example.com billing@example.com .env.local
 */

import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { resolve } from "path";

const args = process.argv.slice(2);
if (args.length < 2) {
  console.error("Usage: npx tsx scripts/add-email-alias.ts <canonical_email> <alias_email> [env-file]");
  process.exit(1);
}

const [canonicalEmail, aliasEmail, envFile = ".env.local"] = args;

const envPath = resolve(process.cwd(), envFile);
console.log(`Loading environment from: ${envPath}`);
const result = config({ path: envPath });

if (result.error) {
  console.error(`Failed to load ${envFile}:`, result.error.message);
  process.exit(1);
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function addEmailAlias() {
  console.log(`\nAdding email alias:`);
  console.log(`  Canonical: ${canonicalEmail}`);
  console.log(`  Alias:     ${aliasEmail}\n`);

  // Check existing alias
  const { data: existing } = await supabase
    .from("member_email_aliases")
    .select("*")
    .ilike("alias_email", aliasEmail)
    .single();

  if (existing) {
    console.log(`Alias already exists: ${aliasEmail} → ${existing.canonical_email}`);
    return;
  }

  // Verify both emails have member records
  const { data: canonicalMember } = await supabase
    .from("members")
    .select("id, name, email")
    .ilike("email", canonicalEmail)
    .single();

  const { data: aliasMember } = await supabase
    .from("members")
    .select("id, name, email")
    .ilike("email", aliasEmail)
    .single();

  if (!canonicalMember) {
    console.warn(`⚠  No member found for canonical email: ${canonicalEmail}`);
  } else {
    console.log(`✓ Canonical member: ${canonicalMember.name} (${canonicalMember.email})`);
  }

  if (!aliasMember) {
    console.warn(`⚠  No member found for alias email: ${aliasEmail}`);
  } else {
    console.log(`✓ Alias member: ${aliasMember.name} (${aliasMember.email})`);
  }

  // Insert the alias
  const { error } = await supabase.from("member_email_aliases").insert({
    canonical_email: canonicalEmail.toLowerCase(),
    alias_email: aliasEmail.toLowerCase(),
    source: "manual",
  });

  if (error) {
    console.error(`\n❌ Failed to insert alias: ${error.message}`);
    process.exit(1);
  }

  console.log(`\n✅ Alias created successfully`);
  console.log(`\nNext steps:`);
  console.log(`  1. Run member reprocessing: POST /api/process/members`);
  console.log(`     This will merge the two member records into one (${canonicalEmail})`);
  console.log(`  2. Refresh the reconciliation page to verify the discrepancy is resolved`);
}

addEmailAlias().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
