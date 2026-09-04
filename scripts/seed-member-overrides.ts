/**
 * One-time script to seed initial member status overrides
 * Run after members have been imported from Kajabi
 *
 * Usage:
 *   npx tsx scripts/seed-member-overrides.ts [env-file]
 *
 * Examples:
 *   npx tsx scripts/seed-member-overrides.ts .env.local
 *   npx tsx scripts/seed-member-overrides.ts .env.production
 */

import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { resolve } from "path";

// Parse command-line arguments
const args = process.argv.slice(2);
const envFile = args[0] || ".env.local";

// Load environment variables from specified file
const envPath = resolve(process.cwd(), envFile);
console.log(`Loading environment from: ${envPath}`);
const result = config({ path: envPath });

if (result.error) {
  console.error(`Failed to load ${envFile}:`, result.error.message);
  console.error("Make sure the file exists and contains the required variables.");
  process.exit(1);
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error("Missing environment variables:");
  console.error("- NEXT_PUBLIC_SUPABASE_URL");
  console.error("- SUPABASE_SERVICE_ROLE_KEY");
  console.error(`\nMake sure ${envFile} contains these variables.`);
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

interface SpecialCaseMember {
  email: string;
  name: string;
  override_type: "gift" | "special";
  reason: string;
  notes: string;
}

const specialCaseMembers: SpecialCaseMember[] = [
  // 180 Program Members (6 total)
  {
    email: "member1@example.com",
    name: "Member 1",
    override_type: "gift",
    reason: "180 program",
    notes: "6 months free membership as part of 180 program",
  },
  {
    email: "member2@example.com",
    name: "Member 2",
    override_type: "gift",
    reason: "180 program",
    notes: "6 months free membership as part of 180 program",
  },
  {
    email: "member3@example.com", // Also matches member3b@example.com in Stripe
    name: "Member 3",
    override_type: "gift",
    reason: "180 program",
    notes: "6 months free membership as part of 180 program",
  },
  {
    email: "member4@example.com",
    name: "Member 4",
    override_type: "gift",
    reason: "180 program",
    notes: "6 months free membership as part of 180 program",
  },
  {
    email: "member5@example.com",
    name: "Member 5",
    override_type: "gift",
    reason: "180 program",
    notes: "6 months free membership as part of 180 program",
  },
  {
    email: "member6@example.com",
    name: "Member 6",
    override_type: "gift",
    reason: "180 program",
    notes: "6 months free membership as part of 180 program",
  },
  // Gift Members (2 total)
  {
    email: "member7@example.com",
    name: "Member 7",
    override_type: "gift",
    reason: "Mika affiliates compensation",
    notes: "Gift compensation for missed Mika affiliates",
  },
  {
    email: "member8@example.com",
    name: "Member 8",
    override_type: "gift",
    reason: "hosting gift",
    notes: "Gift membership for hosting services",
  },
];

async function seedMemberOverrides() {
  console.log("Starting member overrides seed...\n");

  let successCount = 0;
  let failureCount = 0;
  const errors: string[] = [];

  for (const specialCase of specialCaseMembers) {
    console.log(`Processing ${specialCase.name} (${specialCase.email})...`);

    // Step 1: Check if email is an alias and get canonical email
    const { data: aliasData } = await supabase
      .from("member_email_aliases")
      .select("canonical_email")
      .ilike("alias_email", specialCase.email)
      .single();

    // Use canonical email if it's an alias, otherwise use the original email
    const emailToLookup = aliasData?.canonical_email || specialCase.email;

    // Step 2: Find member by email
    const { data: members, error: memberError } = await supabase
      .from("members")
      .select("id, name, email")
      .ilike("email", emailToLookup)
      .limit(1);

    if (memberError) {
      console.error(`  ❌ Error fetching member: ${memberError.message}`);
      failureCount++;
      errors.push(`${specialCase.name}: ${memberError.message}`);
      continue;
    }

    if (!members || members.length === 0) {
      console.warn(`  ⚠️  Member not found - skipping`);
      failureCount++;
      errors.push(`${specialCase.name}: Member not found in database`);
      continue;
    }

    const member = members[0];

    // Check if override already exists
    const { data: existingOverride } = await supabase
      .from("member_status_overrides")
      .select("id")
      .eq("member_id", member.id)
      .single();

    if (existingOverride) {
      console.log(`  ℹ️  Override already exists - skipping`);
      continue;
    }

    // Create override
    const { error: insertError } = await supabase
      .from("member_status_overrides")
      .insert({
        member_id: member.id,
        override_type: specialCase.override_type,
        reason: specialCase.reason,
        notes: specialCase.notes,
      });

    if (insertError) {
      console.error(`  ❌ Error creating override: ${insertError.message}`);
      failureCount++;
      errors.push(`${specialCase.name}: ${insertError.message}`);
    } else {
      console.log(`  ✅ Created override`);
      successCount++;
    }
  }

  console.log("\n" + "=".repeat(60));
  console.log(`Seed completed:`);
  console.log(`  ✅ Success: ${successCount}`);
  console.log(`  ❌ Failures: ${failureCount}`);

  if (errors.length > 0) {
    console.log("\nErrors:");
    errors.forEach((error) => console.log(`  - ${error}`));
  }

  console.log("=".repeat(60));
}

seedMemberOverrides().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
