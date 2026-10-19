import { requireAdmin } from "@/lib/supabase/api-auth";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { CourseProcessingError, processCourses } from "@/lib/courses/process";
import { NextRequest, NextResponse } from "next/server";

export const maxDuration = 300;

/**
 * Bronze (Kajabi) -> Silver courses, modules, lessons and `course_access` (docs/COURSES.md, step C).
 *
 * Body: `{ "course": "the-ready-writer", "accessDuration": "1 year" }`. `course` is the Silver
 * slug (a new course gets the slug of its Kajabi title); omit it to refresh every Kajabi course
 * already in Silver. `accessDuration` (an interval; `null` for lifetime) is set on the course
 * when given and left alone otherwise.
 *
 * The caller is checked as an admin, then the writes use the service role: signed-in admins can
 * read the course tables but not write them.
 *
 * Reprocessable: Silver rows are upserted on their source key and orphans deleted, so ids stay
 * stable and a lesson that's deleted, drafted or hidden in Kajabi disappears on the next run.
 */
export async function POST(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (!auth.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (auth.forbidden) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await request.json().catch(() => undefined);
  if (body === undefined) return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });

  const courseSlug = typeof body?.course === "string" && body.course ? body.course : undefined;
  const accessDuration =
    body && "accessDuration" in body && (body.accessDuration === null || typeof body.accessDuration === "string")
      ? (body.accessDuration as string | null)
      : undefined;

  try {
    const result = await processCourses(createServiceRoleClient(), { courseSlug, accessDuration });
    return NextResponse.json({ success: true, ...result });
  } catch (error: any) {
    if (error instanceof CourseProcessingError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Course processing failed:", error);
    return NextResponse.json({ error: error.message || "Processing failed" }, { status: 500 });
  }
}
