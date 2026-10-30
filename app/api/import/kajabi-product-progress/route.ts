import { requireAdmin } from "@/lib/supabase/api-auth";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { createRepos } from "@/lib/data/repos";
import { importProductProgress } from "@/lib/courses/product-progress";
import { parseProductProgressCsv, ProgressCsvError } from "@/lib/courses/product-progress-csv";
import { NextRequest, NextResponse } from "next/server";

export const maxDuration = 120;

/** A Product Progress report is a few dozen to a few thousand short rows. */
const MAX_FILE_BYTES = 2 * 1024 * 1024;
/** Invalid rows listed back to the admin; the count is always complete. */
const MAX_INVALID_LISTED = 50;

/**
 * Kajabi "Product Progress" report CSV -> bronze.kajabi_product_progress (docs/COURSES.md).
 *
 * Multipart form: `courseId` (a Kajabi course already in Bronze) and `file` (the CSV). The report
 * does not say which product it is for, so the admin picks. Any invalid row rejects the whole file
 * with 422 and writes nothing, so a malformed line can never soft-delete a student; the response
 * lists line numbers and reasons, never names or emails. The answer is counts, plus the uploaded
 * emails that match no member (the admin already has them; they are not logged).
 */
export async function POST(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (!auth.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (auth.forbidden) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const form = await request.formData().catch(() => undefined);
  if (!form) return NextResponse.json({ error: "Send the course and the CSV as a form upload" }, { status: 400 });

  const courseId = form.get("courseId");
  const file = form.get("file");
  if (typeof courseId !== "string" || courseId.trim() === "") {
    return NextResponse.json({ error: "Choose which course the report is for" }, { status: 400 });
  }
  if (!(file instanceof File)) return NextResponse.json({ error: "No file provided" }, { status: 400 });
  if (!file.name.toLowerCase().endsWith(".csv")) return NextResponse.json({ error: "File must be a CSV" }, { status: 400 });
  if (file.size > MAX_FILE_BYTES) return NextResponse.json({ error: "File is too large for a progress report" }, { status: 413 });

  let parsed;
  try {
    parsed = parseProductProgressCsv(await file.text());
  } catch (error) {
    if (error instanceof ProgressCsvError) return NextResponse.json({ error: error.message }, { status: 400 });
    throw error;
  }
  if (parsed.invalid.length > 0) {
    return NextResponse.json(
      {
        error: `${parsed.invalid.length} of ${parsed.rowsRead} rows could not be read, so nothing was imported. Fix the file and upload it again.`,
        rowsRead: parsed.rowsRead,
        invalidCount: parsed.invalid.length,
        invalid: parsed.invalid.slice(0, MAX_INVALID_LISTED),
      },
      { status: 422 },
    );
  }
  if (parsed.rows.length === 0) return NextResponse.json({ error: "The file has no rows" }, { status: 400 });

  try {
    const db = createServiceRoleClient();
    const repos = createRepos(db);
    const course = await repos.kajabiCourses.liveCourse(courseId);
    if (!course) return NextResponse.json({ error: "That course is not in the imported Kajabi courses" }, { status: 400 });

    const result = await importProductProgress(db, repos, {
      courseKajabiId: course.kajabi_id,
      rows: parsed.rows,
      sourceFile: file.name.slice(0, 200),
    });
    return NextResponse.json({ success: true, rowsRead: parsed.rowsRead, ...result });
  } catch (error: any) {
    console.error("Kajabi product progress import failed:", error?.message);
    return NextResponse.json({ error: "Import failed" }, { status: 500 });
  }
}
