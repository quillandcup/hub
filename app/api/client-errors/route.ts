import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { templateRoute } from "@/lib/analytics/route";
import { isId } from "@/lib/ids";
import { sendOperationsAlert, type PlaybackFailure } from "@/lib/operations-alerts";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { createRepos } from "@/lib/data/repos";

/**
 * What the player said about a playback failure, keeping only values of the expected shape: a lesson id, a Mux playback id
 * (letters and digits), a bare hls.js word, numbers and a boolean. Anything else is dropped, so nothing free-form (or a token) reaches Slack.
 */
function parsePlaybackFailure(value: unknown): PlaybackFailure | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const v = value as Record<string, unknown>;
  const int = (n: unknown, min: number, max: number) => (typeof n === "number" && Number.isInteger(n) && n >= min && n <= max ? n : undefined);
  const code = int(v.code, 0, 100);
  if (code === undefined) return undefined;
  return {
    code,
    lessonId: typeof v.lessonId === "string" && isId(v.lessonId, "les") ? v.lessonId : undefined,
    playbackId: typeof v.playbackId === "string" && /^[A-Za-z0-9]{10,60}$/.test(v.playbackId) ? v.playbackId : undefined,
    restricted: typeof v.restricted === "boolean" ? v.restricted : undefined,
    status: int(v.status, 100, 599),
    detail: typeof v.detail === "string" && /^[A-Za-z]{1,40}$/.test(v.detail) ? v.detail : undefined,
  };
}

/**
 * A page crashed in the browser (components/RouteError.tsx). A server error is alerted from the server,
 * but a render error in the browser never reaches it, so the error page reports it here and it goes to
 * #hub-alerts. Signed-in people only, and one alert per route every ten minutes (sendOperationsAlert),
 * so it can't be used to flood the channel. Only the route template and a short message are kept. `kind: "video"`
 * is the course player reporting a playback error (components/courses/LessonPlayer.tsx).
 */
export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => undefined);
  const route = templateRoute(body?.path);
  if (!route || typeof body?.message !== "string") return NextResponse.json({ error: "Invalid report" }, { status: 400 });

  const repos = createRepos(createServiceRoleClient());
  // A course video that failed to play is reported the same way, as its own kind.
  if (body.kind === "video") await sendOperationsAlert(repos, { type: "video_failed", what: "playback", route, detail: body.message, playback: parsePlaybackFailure(body.playback) });
  else await sendOperationsAlert(repos, { type: "client_crash", route, message: body.message });
  return new NextResponse(null, { status: 204 });
}
