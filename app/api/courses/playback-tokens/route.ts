import { NextRequest, NextResponse } from "next/server";
import { getCoursesCaller } from "@/lib/courses/caller";
import { canOpenLessons, loadMemberCourseAccess } from "@/lib/courses/member";
import { createRepos } from "@/lib/data/repos";
import { isId } from "@/lib/ids";
import { createMuxClient, signPlaybackTokens } from "@/lib/mux";
import { restrictionIdForViewer } from "@/lib/mux-restriction.server";
import { hitRateLimits } from "@/lib/rate-limit";
import { createServiceRoleClient } from "@/lib/supabase/service";

/** Fresh links are only needed when a long-open tab's links expire, so a few per ten minutes is plenty. */
const LIMIT = { windowSeconds: 10 * 60, maxHits: 10 };

/** Never cached: the body is a credential. */
const NO_STORE = { "Cache-Control": "no-store" };

/**
 * Fresh playback links for one lesson's video, for a lesson tab that has been open past the 1 hour the page's
 * links last (components/courses/LessonPlayer.tsx asks once when the player hits a network error; see
 * lib/courses/playback-refresh.ts). The same checks as the lesson page and the watch route: the signed-in member with
 * courses on (the effective member in sudo), access to the lesson's course, an open lesson (staff acting as themselves
 * may also open an unreleased one), and a ready video. Every refusal after sign-in is the same 404, so nothing says
 * which lessons exist. The referrer restriction is added by the same rule as the page (`restrictionIdForViewer`).
 */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => undefined);
  if (typeof body?.lessonId !== "string" || !isId(body.lessonId, "les")) return NextResponse.json({ error: "Invalid request" }, { status: 400, headers: NO_STORE });

  const caller = await getCoursesCaller();
  if (!caller) return NextResponse.json({ error: "Not available" }, { status: 401, headers: NO_STORE });

  const service = createServiceRoleClient();
  const repos = createRepos(service);
  if (!(await hitRateLimits(repos, [{ bucket: `course_playback_tokens:user:${caller.userId}`, ...LIMIT }]))) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429, headers: { ...NO_STORE, "Retry-After": String(LIMIT.windowSeconds) } });
  }

  const notFound = () => NextResponse.json({ error: "Not found" }, { status: 404, headers: NO_STORE });
  const lesson = await repos.courses.lessonById(body.lessonId);
  const openToCaller = lesson?.state === "open" || caller.scope.isAdminActing;
  if (!lesson || !openToCaller || !lesson.video_id) return notFound();
  if (!canOpenLessons(await loadMemberCourseAccess(repos, caller.scope, lesson.course_id))) return notFound();

  const video = (await repos.courses.videosByIds([lesson.video_id]))[0];
  if (!video || video.status !== "ready" || !video.mux_playback_id) return notFound();

  const restrictionId = await restrictionIdForViewer(caller.userId, caller.identity);
  try {
    const tokens = await signPlaybackTokens(createMuxClient(), video.mux_playback_id, undefined, restrictionId);
    return NextResponse.json({ tokens, restricted: restrictionId !== null }, { headers: NO_STORE });
  } catch (error) {
    console.error("Couldn't mint Mux playback tokens:", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "Couldn't create a playback link" }, { status: 502, headers: NO_STORE });
  }
}
