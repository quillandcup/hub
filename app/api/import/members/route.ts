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
    const { rawData, members } = parseCSV(text);

    if (members.length === 0) {
      return NextResponse.json(
        { error: "No valid members found in CSV" },
        { status: 400 }
      );
    }

    // Step 1: Insert into kajabi_members (raw data - temporal snapshots)
    const importTimestamp = new Date().toISOString();
    const { error: kajabiError } = await supabase
      .from("kajabi_members")
      .insert(
        rawData.map((row) => ({
          email: row.email.toLowerCase(),
          imported_at: importTimestamp,
          data: row,
        }))
      );

    if (kajabiError) {
      console.error("Error inserting to kajabi_members:", kajabiError);
      throw kajabiError;
    }

    // Step 2: Sync to members table (canonical data with business logic)
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

function parseCSV(text: string): { rawData: any[]; members: MemberRow[] } {
  const lines = text.trim().split("\n");
  if (lines.length < 2) {
    throw new Error("CSV must have a header row and at least one data row");
  }

  const headerLine = lines[0];
  const headers = parseCSVLine(headerLine);

  // Check if this is a Kajabi export
  const isKajabi = headers.includes("Name") && headers.includes("Email") && headers.includes("Member Created At");

  if (isKajabi) {
    return parseKajabiCSV(headers, lines.slice(1));
  } else {
    return parseSimpleCSV(headers, lines.slice(1));
  }
}

function parseKajabiCSV(headers: string[], dataLines: string[]): { rawData: any[]; members: MemberRow[] } {
  const nameIdx = headers.indexOf("Name");
  const emailIdx = headers.indexOf("Email");
  const createdAtIdx = headers.indexOf("Member Created At");
  const tagsIdx = headers.indexOf("Tags");
  const productsIdx = headers.indexOf("Products");

  const rawData: any[] = [];
  const members: MemberRow[] = [];

  for (let i = 0; i < dataLines.length; i++) {
    const line = dataLines[i].trim();
    if (!line) continue;

    const values = parseCSVLine(line);

    const name = values[nameIdx]?.trim();
    const email = values[emailIdx]?.trim();
    const createdAt = values[createdAtIdx]?.trim();
    const tags = values[tagsIdx]?.trim() || "";
    const products = values[productsIdx]?.trim() || "";

    // Skip if missing required fields
    if (!name || !email || !createdAt) {
      console.warn(`Skipping Kajabi row ${i + 2}: missing name, email, or created_at`);
      continue;
    }

    // Validate email
    if (!email.includes("@")) {
      console.warn(`Skipping Kajabi row ${i + 2}: invalid email "${email}"`);
      continue;
    }

    // Store raw data (all columns as JSONB)
    const rawRow: any = { email: email.toLowerCase() };
    headers.forEach((header, idx) => {
      rawRow[header] = values[idx]?.trim() || "";
    });
    rawData.push(rawRow);

    // Derive status from products and tags
    // Active = has membership product
    // On Hiatus = has member tag but product removed during pause
    // Inactive = offboarding tag OR neither product nor tag (leads/trials)
    let status: "active" | "inactive" | "on_hiatus";
    if (products.includes("Quill & Cup Membership")) {
      status = "active"; // Has active membership product
    } else if (tags.includes("Offboarding")) {
      status = "inactive"; // Officially cancelled
    } else if (tags.includes("Quill & Cup Member")) {
      status = "on_hiatus"; // Has member tag but no product = paused
    } else {
      status = "inactive"; // Default: leads, trials, former members
    }

    // Extract plan from products (look for "Membership" product)
    let plan: string | undefined;
    if (products.includes("Quill & Cup Membership")) {
      plan = "Membership";
    } else if (products.includes("BFF Program")) {
      plan = "BFF";
    } else if (products) {
      plan = "Other";
    }

    // Format joined_at (Kajabi format: "2022-09-03 18:49:55 -0600")
    // Convert to ISO date: "2022-09-03"
    const joinedAt = createdAt.split(" ")[0];

    members.push({
      name,
      email: email.toLowerCase(),
      joined_at: joinedAt,
      status,
      plan,
    });
  }

  return { rawData, members };
}

function parseSimpleCSV(headers: string[], dataLines: string[]): { rawData: any[]; members: MemberRow[] } {
  const headerLower = headers.map((h) => h.trim().toLowerCase());
  const requiredColumns = ["name", "email", "joined_at", "status"];

  // Validate required columns exist
  for (const col of requiredColumns) {
    if (!headerLower.includes(col)) {
      throw new Error(`Missing required column: ${col}`);
    }
  }

  const rawData: any[] = [];
  const members: MemberRow[] = [];

  for (let i = 0; i < dataLines.length; i++) {
    const line = dataLines[i].trim();
    if (!line) continue;

    const values = parseCSVLine(line);
    const row: any = {};

    headerLower.forEach((col, index) => {
      row[col] = values[index]?.trim() || "";
    });

    // Validate required fields
    if (!row.name || !row.email || !row.joined_at || !row.status) {
      console.warn(`Skipping row ${i + 2}: missing required fields`);
      continue;
    }

    // Validate status
    if (!["active", "inactive", "on_hiatus"].includes(row.status)) {
      console.warn(
        `Skipping row ${i + 2}: invalid status "${row.status}". Must be: active, inactive, or on_hiatus`
      );
      continue;
    }

    // Validate email format (basic)
    if (!row.email.includes("@")) {
      console.warn(`Skipping row ${i + 2}: invalid email "${row.email}"`);
      continue;
    }

    // Store raw data (all columns as JSONB)
    const rawRow: any = { email: row.email.toLowerCase() };
    headers.forEach((header, idx) => {
      rawRow[header.trim().toLowerCase()] = values[idx]?.trim() || "";
    });
    rawData.push(rawRow);

    members.push({
      name: row.name,
      email: row.email.toLowerCase(),
      joined_at: row.joined_at,
      status: row.status,
      plan: row.plan || undefined,
    });
  }

  return { rawData, members };
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
