import { requireAdmin } from "@/lib/supabase/api-auth";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { createKajabiClient } from "@/lib/kajabi/client";
import { CourseImportError, importKajabiCourses } from "@/lib/courses/import";
import { NextRequest, NextResponse } from "next/server";

export const maxDuration = 300;

/**
 * Kajabi courses -> Bronze (docs/COURSES.md, step A): see lib/courses/import.ts. The standard
 * Kajabi sync (/api/import/kajabi) runs this too; this route is for importing on its own.
 *
 * Body: `{ "courseIds": ["..."] }` limits the run to those courses; omit it for every course.
 * The caller is checked as an admin, then the writes use the service role: signed-in admins can
 * read the course tables but not write them.
 */
export async function POST(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (!auth.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (auth.forbidden) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await request.json().catch(() => ({}));
  const courseIds: string[] | undefined = Array.isArray(body?.courseIds) ? body.courseIds.map(String) : undefined;

  try {
    const result = await importKajabiCourses(createServiceRoleClient(), createKajabiClient(), { courseIds });
    return NextResponse.json({ success: true, ...result });
  } catch (error: any) {
    if (error instanceof CourseImportError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error("Kajabi courses import failed:", error);
    return NextResponse.json({ error: error.message || "Import failed" }, { status: 500 });
  }
}
