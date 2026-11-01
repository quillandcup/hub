import { createRepos } from "@/lib/data/repos";
import { requireAdmin } from "@/lib/supabase/api-auth";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { courseMuxApi, createMuxClient } from "@/lib/mux";
import { refreshVideoStatuses, uploadCourseVideos } from "@/lib/courses/media";
import { processCourses } from "@/lib/courses/process";
import { NextRequest, NextResponse } from "next/server";

export const maxDuration = 300;

/**
 * Course videos -> Mux (docs/COURSES.md, step D): see lib/courses/media.ts.
 *
 * Body: `{ "course": "the-ready-writer", "action": "upload" | "upload_drafts" | "refresh", "mediaIds"?: [...] }`.
 * - `upload` sends the course's visible lessons' videos that aren't in Mux yet (each is billed), then
 *   brings statuses up to date and links the lessons to their videos.
 * - `upload_drafts` does the same for the videos only draft lessons use, which `upload` never sends.
 * - `mediaIds` (Kajabi media ids, for either upload) sends exactly those videos and no others; omit
 *   it to send every video of that kind. An empty list is refused rather than read as "all".
 * - `refresh` only brings statuses up to date from Mux (for when the webhook hasn't delivered) and
 *   links lessons.
 * An explicit action, never part of the automatic sync, because uploads cost money.
 *
 * The caller is checked as an admin, then the writes use the service role.
 */
export async function POST(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (!auth.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (auth.forbidden) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await request.json().catch(() => undefined);
  if (body === undefined) return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  const slug = typeof body?.course === "string" ? body.course : "";
  const action = body?.action;
  const mediaIds: unknown = body?.mediaIds;
  if (mediaIds !== undefined && (!Array.isArray(mediaIds) || mediaIds.length === 0 || mediaIds.length > 500 || mediaIds.some((id) => typeof id !== "string" || id === ""))) {
    return NextResponse.json({ error: '"mediaIds" must be a non-empty list of media ids' }, { status: 400 });
  }
  if (!slug || (action !== "upload" && action !== "upload_drafts" && action !== "refresh")) {
    return NextResponse.json({ error: 'Body needs "course" (a slug) and "action" ("upload", "upload_drafts" or "refresh")' }, { status: 400 });
  }
  if (!process.env.MUX_TOKEN_ID || !process.env.MUX_TOKEN_SECRET) {
    return NextResponse.json({ error: "Mux isn't configured here (MUX_TOKEN_ID / MUX_TOKEN_SECRET)" }, { status: 503 });
  }

  const supabase = createServiceRoleClient();
  const course = await createRepos(supabase).courses.courseBySlug(slug, { source: "kajabi" });
  if (!course) return NextResponse.json({ error: `No published course "${slug}"` }, { status: 404 });
  if (!course.source_key) return NextResponse.json({ error: `Course "${slug}" has no source key` }, { status: 409 });

  try {
    const api = courseMuxApi(createMuxClient());
    const upload =
      action === "refresh"
        ? undefined
        : await uploadCourseVideos(createRepos(supabase), api, course.source_key, new Date(), undefined, {
            drafts: action === "upload_drafts",
            mediaIds: mediaIds as string[] | undefined,
          });
    const refresh = await refreshVideoStatuses(createRepos(supabase), api);
    // Links each lesson to its video (a lesson without a `videos` row yet keeps its existing link).
    const processed = await processCourses(createRepos(supabase), { courseSlug: slug });
    return NextResponse.json({ success: true, upload, refresh, lessons: processed.courses[0]?.lessons });
  } catch (error: any) {
    console.error("Course media step failed:", error);
    return NextResponse.json({ error: error.message || "Media step failed" }, { status: 500 });
  }
}
