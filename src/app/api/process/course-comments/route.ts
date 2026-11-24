import { requireApiPermission } from "@/lib/supabase/api-auth";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { CommentsImportError, importKajabiLessonComments } from "@/lib/courses/comments-import";
import { NextRequest, NextResponse } from "next/server";
import { createRepos } from "@/lib/data/repos";

export const maxDuration = 300;

/**
 * Bronze Kajabi lesson comments -> Silver `lesson_comments` (docs/product/COURSES.md, "Lesson comments", Kajabi migration).
 * Body: `{ "course": "self-editing-academy", "dryRun": true }`; `course` is the Silver slug (omit it for every Kajabi
 * course); `dryRun` counts without writing. The source is the capture in Bronze (`courses:content --comments`), run by a person
 * on their own machine, so this route is the second half of a manual pull, not a webhook's twin.
 *
 * Keyed on Kajabi's own ids (`source` + `source_key`), so running it again changes nothing; it never creates a follow, a
 * notification or a report, and never touches what staff did to a comment (see `importKajabiLessonComments`). The caller is
 * checked as an admin, then the writes use the service role. The response carries counts only, never names or text.
 */
export async function POST(request: NextRequest) {
  const auth = await requireApiPermission(request, "data.pipeline.run");
  if (!auth.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (auth.forbidden) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await request.json().catch(() => undefined);
  if (body === undefined) return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });

  const courseSlug = typeof body?.course === "string" && body.course ? body.course : undefined;
  const dryRun = body?.dryRun === true;

  try {
    const result = await importKajabiLessonComments(createRepos(createServiceRoleClient()), { courseSlug, dryRun });
    return NextResponse.json({ success: true, ...result });
  } catch (error: unknown) {
    if (error instanceof CommentsImportError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error("Course comments import failed:", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "Processing failed" }, { status: 500 });
  }
}
