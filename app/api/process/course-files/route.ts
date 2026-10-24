import { requireAdmin } from "@/lib/supabase/api-auth";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { copyCourseFiles } from "@/lib/courses/files";
import { NextRequest, NextResponse } from "next/server";

export const maxDuration = 300;

/**
 * Lesson downloads -> the Hub (docs/COURSES.md, step D, files): see lib/courses/files.ts.
 *
 * Body: `{ "course": "the-ready-writer" }`. Copies the files of the course's visible lessons that
 * aren't in the Hub yet into the private `course-files` bucket, and removes the ones Kajabi no longer
 * lists. Unlike the video upload this costs nothing, so it has no confirm step.
 *
 * The caller is checked as an admin, then the work uses the service role.
 */
export async function POST(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (!auth.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (auth.forbidden) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await request.json().catch(() => undefined);
  if (body === undefined) return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  const slug = typeof body?.course === "string" ? body.course : "";
  if (!slug) return NextResponse.json({ error: 'Body needs "course" (a slug)' }, { status: 400 });

  const supabase = createServiceRoleClient();
  const { data: course } = await supabase.from("courses").select("source_key").eq("slug", slug).eq("source", "kajabi").maybeSingle();
  if (!course) return NextResponse.json({ error: `No published course "${slug}"` }, { status: 404 });

  if (!course.source_key) return NextResponse.json({ error: `Course "${slug}" has no source key` }, { status: 409 });

  try {
    return NextResponse.json({ success: true, ...(await copyCourseFiles(supabase, course.source_key, new Date())) });
  } catch (error: any) {
    console.error("Course files step failed:", error);
    return NextResponse.json({ error: error.message || "Copying files failed" }, { status: 500 });
  }
}
