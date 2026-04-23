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
      console.log(`Attempting to insert alias: "${alias}" for member ${member.id} (${member.name})`);
      const { data: insertData, error: insertError } = await supabase
        .from("member_name_aliases")
        .insert({
          member_id: member.id,
          alias: alias,
        })
        .select();

      console.log(`Insert result for "${alias}":`, { data: insertData, error: insertError });

      if (insertError) {
        messages.push(`Error creating alias "${alias}" for ${email}: ${insertError.message}`);
        errors++;
        continue;
      }

      messages.push(`Created: "${alias}" → ${member.name} (${email})`);
      created++;
    }

    // Auto-trigger attendance reprocessing ONLY (skip members to avoid cascade delete)
    // Aliases reference member_id with ON DELETE CASCADE, so if members get deleted
    // and recreated (which happens in member reprocessing), all aliases are lost
    let processingResults = null;
    if (created > 0) {
      console.log(`Triggering attendance reprocessing for last 90 days (skipping members to preserve aliases)`);
      const now = new Date();
      const ninetyDaysAgo = new Date();
      ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

      // Directly trigger attendance processing (skip members dependency)
      const baseUrl = process.env.VERCEL_URL
        ? `https://${process.env.VERCEL_URL}`
        : 'http://localhost:3000';

      const response = await fetch(`${baseUrl}/api/process/attendance`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
        },
        body: JSON.stringify({
          fromDate: ninetyDaysAgo.toISOString(),
          toDate: now.toISOString()
        })
      });

      if (response.ok) {
        const result = await response.json();
        processingResults = { processed: [{ table: 'attendance', success: true, ...result }] };
      } else {
        const error = await response.text();
        console.error('Attendance reprocessing failed:', error);
        processingResults = { processed: [{ table: 'attendance', success: false, error }] };
      }
    }

    return NextResponse.json({
      success: true,
      total: rows.length,
      created,
      skipped,
      errors,
      messages,
      processing: processingResults?.processed || [],
    });
  } catch (error: any) {
    console.error("Error applying aliases:", error);
    return NextResponse.json(
      { error: error.message || "Failed to apply aliases" },
      { status: 500 }
    );
  }
}
