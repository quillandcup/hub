import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { loadLiveRoom } from "@/lib/live-room";
import { withTimeout, AUTH_CHECK_TIMEOUT_MS } from "@/lib/with-timeout";

export const dynamic = "force-dynamic";

/**
 * Who's in the prickle Zoom room right now, polled by the header's On air light
 * (components/LiveRoomIndicator.tsx). Any signed-in user; the data is read with the service
 * role because the participant events table is service role only.
 */
export async function GET() {
  let user;
  try {
    user = await withTimeout(getCurrentUser(), AUTH_CHECK_TIMEOUT_MS);
  } catch {
    return NextResponse.json({ error: "Auth check timed out" }, { status: 503 });
  }
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const room = await loadLiveRoom(createServiceRoleClient());
    return NextResponse.json(room, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("loadLiveRoom failed", error);
    return NextResponse.json({ error: "Could not load the live room" }, { status: 500 });
  }
}
