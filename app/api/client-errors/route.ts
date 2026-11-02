import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { templateRoute } from "@/lib/analytics/route";
import { sendOperationsAlert } from "@/lib/operations-alerts";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { createRepos } from "@/lib/data/repos";

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
  if (body.kind === "video") await sendOperationsAlert(repos, { type: "video_failed", what: "playback", route, detail: body.message });
  else await sendOperationsAlert(repos, { type: "client_crash", route, message: body.message });
  return new NextResponse(null, { status: 204 });
}
