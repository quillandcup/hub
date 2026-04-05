import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";

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
    const rawData = parseCSV(text);

    if (rawData.length === 0) {
      return NextResponse.json(
        { error: "No valid members found in CSV" },
        { status: 400 }
      );
    }

    // Insert into kajabi_members (Bronze - raw data only)
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

    return NextResponse.json({
      success: true,
      imported: rawData.length,
      importTimestamp,
      message: "Imported to kajabi_members. Run /api/process/members to populate members table.",
    });
  } catch (error: any) {
    console.error("Error importing members:", error);
    return NextResponse.json(
      { error: error.message || "Failed to import members" },
      { status: 500 }
    );
  }
}

function parseCSV(text: string): any[] {
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

function parseKajabiCSV(headers: string[], dataLines: string[]): any[] {
  const nameIdx = headers.indexOf("Name");
  const emailIdx = headers.indexOf("Email");
  const createdAtIdx = headers.indexOf("Member Created At");

  const rawData: any[] = [];

  for (let i = 0; i < dataLines.length; i++) {
    const line = dataLines[i].trim();
    if (!line) continue;

    const values = parseCSVLine(line);

    const name = values[nameIdx]?.trim();
    const email = values[emailIdx]?.trim();
    const createdAt = values[createdAtIdx]?.trim();

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

    // Store raw data (all columns as JSONB) - no business logic
    const rawRow: any = { email: email.toLowerCase() };
    headers.forEach((header, idx) => {
      rawRow[header] = values[idx]?.trim() || "";
    });
    rawData.push(rawRow);
  }

  return rawData;
}

function parseSimpleCSV(headers: string[], dataLines: string[]): any[] {
  const headerLower = headers.map((h) => h.trim().toLowerCase());
  const requiredColumns = ["name", "email"];

  // Validate required columns exist
  for (const col of requiredColumns) {
    if (!headerLower.includes(col)) {
      throw new Error(`Missing required column: ${col}`);
    }
  }

  const rawData: any[] = [];

  for (let i = 0; i < dataLines.length; i++) {
    const line = dataLines[i].trim();
    if (!line) continue;

    const values = parseCSVLine(line);
    const row: any = {};

    headerLower.forEach((col, index) => {
      row[col] = values[index]?.trim() || "";
    });

    // Validate required fields
    if (!row.name || !row.email) {
      console.warn(`Skipping row ${i + 2}: missing required fields`);
      continue;
    }

    // Validate email format (basic)
    if (!row.email.includes("@")) {
      console.warn(`Skipping row ${i + 2}: invalid email "${row.email}"`);
      continue;
    }

    // Store raw data (all columns as JSONB) - no business logic
    const rawRow: any = { email: row.email.toLowerCase() };
    headers.forEach((header, idx) => {
      rawRow[header.trim().toLowerCase()] = values[idx]?.trim() || "";
    });
    rawData.push(rawRow);
  }

  return rawData;
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
