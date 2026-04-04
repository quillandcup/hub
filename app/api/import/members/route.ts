import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";

interface MemberRow {
  name: string;
  email: string;
  joined_at: string;
  status: "active" | "inactive" | "on_hiatus";
  plan?: string;
}

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
    const formData = await request.formData();
    const file = formData.get("file") as File;

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    if (!file.name.endsWith(".csv")) {
      return NextResponse.json(
        { error: "File must be a CSV" },
        { status: 400 }
      );
    }

    const text = await file.text();
    const members = parseCSV(text);

    if (members.length === 0) {
      return NextResponse.json(
        { error: "No valid members found in CSV" },
        { status: 400 }
      );
    }

    // Upsert members (insert or update based on email)
    const { data, error } = await supabase
      .from("members")
      .upsert(
        members.map((m) => ({
          email: m.email,
          name: m.name,
          joined_at: m.joined_at,
          status: m.status,
          plan: m.plan || null,
        })),
        {
          onConflict: "email",
        }
      )
      .select();

    if (error) {
      console.error("Error upserting members:", error);
      throw error;
    }

    return NextResponse.json({
      success: true,
      imported: data?.length || 0,
      members: data,
    });
  } catch (error: any) {
    console.error("Error importing members:", error);
    return NextResponse.json(
      { error: error.message || "Failed to import members" },
      { status: 500 }
    );
  }
}

function parseCSV(text: string): MemberRow[] {
  const lines = text.trim().split("\n");
  if (lines.length < 2) {
    throw new Error("CSV must have a header row and at least one data row");
  }

  const header = lines[0].split(",").map((h) => h.trim().toLowerCase());
  const requiredColumns = ["name", "email", "joined_at", "status"];

  // Validate required columns exist
  for (const col of requiredColumns) {
    if (!header.includes(col)) {
      throw new Error(`Missing required column: ${col}`);
    }
  }

  const members: MemberRow[] = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue; // Skip empty lines

    const values = parseCSVLine(line);
    const row: any = {};

    header.forEach((col, index) => {
      row[col] = values[index]?.trim() || "";
    });

    // Validate required fields
    if (!row.name || !row.email || !row.joined_at || !row.status) {
      console.warn(`Skipping row ${i + 1}: missing required fields`);
      continue;
    }

    // Validate status
    if (!["active", "inactive", "on_hiatus"].includes(row.status)) {
      console.warn(
        `Skipping row ${i + 1}: invalid status "${row.status}". Must be: active, inactive, or on_hiatus`
      );
      continue;
    }

    // Validate email format (basic)
    if (!row.email.includes("@")) {
      console.warn(`Skipping row ${i + 1}: invalid email "${row.email}"`);
      continue;
    }

    members.push({
      name: row.name,
      email: row.email.toLowerCase(),
      joined_at: row.joined_at,
      status: row.status,
      plan: row.plan || undefined,
    });
  }

  return members;
}

// Parse a CSV line handling quoted fields with commas
function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];

    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === "," && !inQuotes) {
      result.push(current);
      current = "";
    } else {
      current += char;
    }
  }

  result.push(current);
  return result;
}
