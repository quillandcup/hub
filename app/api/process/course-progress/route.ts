import { requireAdmin } from "@/lib/supabase/api-auth";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { CourseProgressError, importKajabiLessonProgress } from "@/lib/courses/progress-import";
import { NextRequest, NextResponse } from "next/server";

export const maxDuration = 300;

/**
 * Bronze Kajabi per-lesson progress -> Silver `lesson_progress` (docs/COURSES.md, "Importing Kajabi per-lesson
 * progress"). Body: `{ "course": "self-editing-academy", "dryRun": true }`; `course` is the Silver slug (omit it
 * for every Kajabi course); `dryRun` counts without writing.
 *
 * Insert-only: it adds completed rows for members who have none, marked imported, and never changes or removes
 * Hub progress (see `importKajabiLessonProgress`). The caller is checked as an admin, then the writes use the
 * service role.
 */
export async function POST(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (!auth.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (auth.forbidden) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await request.json().catch(() => undefined);
  if (body === undefined) return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });

  const courseSlug = typeof body?.course === "string" && body.course ? body.course : undefined;
  const dryRun = body?.dryRun === true;

  try {
    const result = await importKajabiLessonProgress(createServiceRoleClient(), { courseSlug, dryRun });
    return NextResponse.json({ success: true, ...result });
  } catch (error: any) {
    if (error instanceof CourseProgressError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error("Course progress import failed:", error);
    return NextResponse.json({ error: error.message || "Processing failed" }, { status: 500 });
  }
}
