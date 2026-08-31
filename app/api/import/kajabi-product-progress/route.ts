import { requireAdmin } from "@/lib/supabase/api-auth";
import { NextRequest, NextResponse } from "next/server";
import * as XLSX from "xlsx";

/**
 * Import Kajabi's "Product Progress" export (course completion/engagement
 * data) into bronze.kajabi_product_progress.
 *
 * Kajabi exposes no API for this data -- it's a manual Excel export from
 * Analytics -> Product Progress. Rows are stamped with a shared imported_at
 * and appended as a snapshot (not upserted), since the export has no stable
 * per-row ID. This is Bronze-only: no Silver processing is triggered here.
 */

const INSERT_CHUNK_SIZE = 500;

// Kajabi's exact column names aren't confirmed against a live export yet --
// match case-insensitively against likely variants, but always keep the
// full raw row in `data` so nothing is lost if a mapping guess is wrong.
const HEADER_ALIASES: Record<string, string[]> = {
  email: ["email", "member email", "contact email", "customer email"],
  product: ["product", "product name", "course", "course name"],
  completionPercentage: ["completion percentage", "completion %", "% complete", "progress"],
  lessonsCompleted: ["lessons completed", "completed lessons"],
  totalLessons: ["total lessons", "lesson count", "lessons"],
  lastActivityAt: ["last activity", "last activity at", "last active"],
};

export async function POST(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (!auth.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (auth.forbidden) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { supabase } = auth;

  try {
    const formData = await request.formData();
    const file = formData.get("file") as File;

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    if (!file.name.endsWith(".xlsx") && !file.name.endsWith(".xls")) {
      return NextResponse.json(
        { error: "File must be an Excel export (.xlsx or .xls)" },
        { status: 400 }
      );
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const rows = parseProductProgressExcel(buffer);

    if (rows.length === 0) {
      return NextResponse.json(
        { error: "No valid rows found in Product Progress export" },
        { status: 400 }
      );
    }

    const importTimestamp = new Date().toISOString();
    const records = rows.map((row) => ({
      member_email: row.email.toLowerCase(),
      product_name: row.product,
      completion_percentage: row.completionPercentage,
      lessons_completed: row.lessonsCompleted,
      total_lessons: row.totalLessons,
      last_activity_at: row.lastActivityAt,
      imported_at: importTimestamp,
      data: row.raw,
    }));

    let imported = 0;
    for (let i = 0; i < records.length; i += INSERT_CHUNK_SIZE) {
      const chunk = records.slice(i, i + INSERT_CHUNK_SIZE);
      const { error: insertError, data: inserted } = await supabase
        .schema("bronze")
        .from("kajabi_product_progress")
        .upsert(chunk, { onConflict: "member_email,product_name,imported_at" })
        .select();

      if (insertError) {
        console.error("Error inserting kajabi_product_progress chunk:", insertError);
        throw insertError;
      }
      imported += inserted?.length || 0;
    }

    const productBreakdown = rows.reduce((acc: Record<string, number>, row) => {
      acc[row.product] = (acc[row.product] || 0) + 1;
      return acc;
    }, {});

    return NextResponse.json({
      success: true,
      imported,
      importTimestamp,
      productBreakdown,
    });
  } catch (error: any) {
    console.error("Error importing Kajabi Product Progress:", error);
    return NextResponse.json(
      { error: error.message || "Failed to import Kajabi Product Progress" },
      { status: 500 }
    );
  }
}

interface ParsedProgressRow {
  email: string;
  product: string;
  completionPercentage: number | null;
  lessonsCompleted: number | null;
  totalLessons: number | null;
  lastActivityAt: string | null;
  raw: Record<string, any>;
}

function parseProductProgressExcel(buffer: Buffer): ParsedProgressRow[] {
  const workbook = XLSX.read(buffer, { type: "buffer" });
  const firstSheetName = workbook.SheetNames[0];
  if (!firstSheetName) {
    throw new Error("Workbook has no sheets");
  }

  const sheet = workbook.Sheets[firstSheetName];
  const rawRows: Record<string, any>[] = XLSX.utils.sheet_to_json(sheet, { defval: null });

  if (rawRows.length === 0) {
    return [];
  }

  const headers = Object.keys(rawRows[0]);
  const columnMap = mapHeaders(headers);

  if (!columnMap.email || !columnMap.product) {
    throw new Error(
      "Missing required column: could not find an Email or Product column in this export. " +
        `Found columns: ${headers.join(", ")}`
    );
  }

  const results: ParsedProgressRow[] = [];

  for (const [i, row] of rawRows.entries()) {
    const email = columnMap.email ? String(row[columnMap.email] ?? "").trim() : "";
    const product = columnMap.product ? String(row[columnMap.product] ?? "").trim() : "";

    if (!email || !product) {
      console.warn(`Skipping row ${i + 2}: missing email or product`);
      continue;
    }

    if (!email.includes("@")) {
      console.warn(`Skipping row ${i + 2}: invalid email "${email}"`);
      continue;
    }

    results.push({
      email,
      product,
      completionPercentage: toNullableInt(columnMap.completionPercentage ? row[columnMap.completionPercentage] : null),
      lessonsCompleted: toNullableInt(columnMap.lessonsCompleted ? row[columnMap.lessonsCompleted] : null),
      totalLessons: toNullableInt(columnMap.totalLessons ? row[columnMap.totalLessons] : null),
      lastActivityAt: toNullableDate(columnMap.lastActivityAt ? row[columnMap.lastActivityAt] : null),
      raw: row,
    });
  }

  return results;
}

function mapHeaders(headers: string[]): Record<string, string | undefined> {
  const normalized = headers.map((h) => ({ original: h, normalized: h.trim().toLowerCase() }));
  const map: Record<string, string | undefined> = {};

  for (const [key, aliases] of Object.entries(HEADER_ALIASES)) {
    const match = normalized.find((h) => aliases.includes(h.normalized));
    map[key] = match?.original;
    if (!match) {
      console.warn(`[Kajabi Product Progress] Could not find a "${key}" column among: ${headers.join(", ")}`);
    }
  }

  return map;
}

function toNullableInt(value: any): number | null {
  if (value === null || value === undefined || value === "") return null;
  const stripped = typeof value === "string" ? value.replace("%", "").trim() : value;
  const parsed = Number(stripped);
  return Number.isFinite(parsed) ? Math.round(parsed) : null;
}

function toNullableDate(value: any): string | null {
  if (value === null || value === undefined || value === "") return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}
