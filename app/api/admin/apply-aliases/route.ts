import { createClient } from "@/lib/supabase/server";
import { triggerReprocessing } from "@/lib/processing/trigger";
import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";

/**
 * Apply member aliases from supabase/member-aliases.csv
 * This is an on-demand operation that creates aliases for known Zoom name variations
 */
export async function POST(request: NextRequest) {
  const supabase = await createClient();

  // Check authentication
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    // Read the CSV file
    const csvPath = path.join(process.cwd(), "supabase", "member-aliases.csv");

    if (!fs.existsSync(csvPath)) {
      return NextResponse.json(
        { error: "Aliases file not found at supabase/member-aliases.csv" },
        { status: 404 }
      );
    }

    const csvContent = fs.readFileSync(csvPath, "utf-8");
    const lines = csvContent.split("\n").filter(line => line.trim());

    // Skip header row
    const rows = lines.slice(1).map(line => {
      const [email, alias] = line.split(",").map(s => s.trim());
      return { email, alias };
    });

    let created = 0;
    let skipped = 0;
    let errors = 0;
    const messages: string[] = [];

    for (const { email, alias } of rows) {
      if (!email || !alias) {
        messages.push(`Skipped invalid row: email="${email}", alias="${alias}"`);
        skipped++;
        continue;
      }

      // Look up member by email
      const { data: member } = await supabase
        .from("members")
        .select("id, name")
        .eq("email", email)
        .single();

      if (!member) {
        messages.push(`Member not found for email: ${email} (alias: ${alias})`);
        errors++;
        continue;
      }

      // Check if alias already exists
      const { data: existingAlias } = await supabase
        .from("member_name_aliases")
        .select("id")
        .eq("member_id", member.id)
        .eq("alias", alias)
        .single();

      if (existingAlias) {
        messages.push(`Alias already exists: "${alias}" → ${member.name}`);
        skipped++;
        continue;
      }

      // Create the alias
      const { error: insertError } = await supabase
        .from("member_name_aliases")
        .insert({
          member_id: member.id,
          alias: alias,
        });

      if (insertError) {
        messages.push(`Error creating alias "${alias}" for ${email}: ${insertError.message}`);
        errors++;
        continue;
      }

      messages.push(`Created: "${alias}" → ${member.name} (${email})`);
      created++;
    }

    // Auto-trigger attendance reprocessing if any aliases were created (last 90 days)
    if (created > 0) {
      console.log(`Triggering attendance reprocessing from ${created} member_name_aliases changes`);
      await triggerReprocessing('member_name_aliases', 'local');
    }

    return NextResponse.json({
      success: true,
      total: rows.length,
      created,
      skipped,
      errors,
      messages,
    });
  } catch (error: any) {
    console.error("Error applying aliases:", error);
    return NextResponse.json(
      { error: error.message || "Failed to apply aliases" },
      { status: 500 }
    );
  }
}
