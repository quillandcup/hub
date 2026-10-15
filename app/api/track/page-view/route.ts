import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import { normalizeTrackedPath } from "@/lib/page-views";
import { getSessionIdFromAccessToken } from "@/lib/supabase/session-claims";
import { SUDO_COOKIE_NAME, actingAsHeaderValue } from "@/lib/sudo-cookie";
import { withTimeout, AUTH_CHECK_TIMEOUT_MS } from "@/lib/with-timeout";

/**
 * Records one page view in access_events for the signed-in user. Sent by the browser when the
 * pathname changes (components/PageViewTracker.tsx) so Link prefetches, which the proxy can't
 * tell from real visits, never reach the page trail. The proxy still logs every request as
 * non-page activity to keep sessions alive.
 */
export async function POST(request: NextRequest) {
  let user;
  try {
    user = await withTimeout(getCurrentUser(), AUTH_CHECK_TIMEOUT_MS);
  } catch {
    return NextResponse.json({ error: "Auth check timed out" }, { status: 503 });
  }
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => null);
  const path = normalizeTrackedPath(body?.path);
  if (!path) return NextResponse.json({ error: "Invalid path" }, { status: 400 });

  const supabase = await createClient();
  const { data: sessionData } = await supabase.auth.getSession();
  const accessToken = sessionData.session?.access_token;
  const actingAsMemberId =
    actingAsHeaderValue(request.cookies.get(SUDO_COOKIE_NAME)?.value, user.id)?.split(":")[1] ?? null;

  const { error } = await supabase.from("access_events").insert({
    user_id: user.id,
    path,
    is_page: true,
    session_id: accessToken ? getSessionIdFromAccessToken(accessToken) : null,
    acting_as_member_id: actingAsMemberId,
  });
  if (error) {
    console.error("Failed to record page view:", error.message);
    return NextResponse.json({ error: "Failed to record page view" }, { status: 500 });
  }
  return new NextResponse(null, { status: 204 });
}
