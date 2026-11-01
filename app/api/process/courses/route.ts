import { requireAdmin } from "@/lib/supabase/api-auth";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { CourseProcessingError, processCourses } from "@/lib/courses/process";
import { ORG_TIMEZONE } from "@/lib/config";
import { zonedTimeToUtc } from "@/lib/prickle-schedules";
import { NextRequest, NextResponse } from "next/server";

export const maxDuration = 300;

/**
 * Bronze (Kajabi) -> Silver courses, modules, lessons and `course_access` (docs/COURSES.md, step C).
 *
 * Body: `{ "course": "the-ready-writer", "publish": true, "accessDuration": "1 year", "launchOn": "2026-11-02" }`. `course` is the Silver
 * slug (a new course gets the slug of its Kajabi title); omit it to refresh every Kajabi course
 * that has a row, drafts included. Syncing never makes a course available to members: `publish: true`
 * (with `course`) does that, and a course's page can also publish and unpublish it. `accessDuration` (an interval; `null` for lifetime) is set on the course
 * when given and left alone otherwise. `launchOn` (a YYYY-MM-DD day in the organisation's timezone;
 * `null` clears it) is when the course opens: pre-order buyers' access starts then, not at purchase.
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
  const publish = body?.publish === true;
  if (publish && !courseSlug) return NextResponse.json({ error: '"publish" needs a "course"' }, { status: 400 });
  const accessDuration =
    body && "accessDuration" in body && (body.accessDuration === null || typeof body.accessDuration === "string")
      ? (body.accessDuration as string | null)
      : undefined;

  let launchAt: string | null | undefined;
  if (body && "launchOn" in body) {
    if (body.launchOn === null) launchAt = null;
    else if (typeof body.launchOn === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.launchOn) && !Number.isNaN(Date.parse(body.launchOn))) {
      launchAt = zonedTimeToUtc(body.launchOn, "00:00", ORG_TIMEZONE).toISOString();
    } else {
      return NextResponse.json({ error: "launchOn must be a YYYY-MM-DD date or null" }, { status: 400 });
    }
  }

  try {
    const result = await processCourses(createServiceRoleClient(), { courseSlug, publish, accessDuration, launchAt });
    return NextResponse.json({ success: true, ...result });
  } catch (error: any) {
    if (error instanceof CourseProcessingError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Course processing failed:", error);
    return NextResponse.json({ error: error.message || "Processing failed" }, { status: 500 });
  }
}
