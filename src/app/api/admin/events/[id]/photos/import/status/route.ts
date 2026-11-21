import { requireAdmin } from "@/lib/supabase/api-auth";
import { getPickerSession, parseDurationMs } from "@/lib/google-photos-picker/client";
import { getImportSessionCookie } from "@/lib/google-photos-picker/import-session-cookie";
import { NextRequest, NextResponse } from "next/server";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAdmin(request);
  if (!auth.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (auth.forbidden) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;
  const cookie = await getImportSessionCookie(id);
  if (!cookie) {
    return NextResponse.json({ error: "No active import session for this event -- start a new import" }, { status: 409 });
  }

  try {
    const session = await getPickerSession(cookie.accessToken, cookie.sessionId);
    return NextResponse.json({
      mediaItemsSet: session.mediaItemsSet,
      pickerUri: cookie.pickerUri,
      pollIntervalMs: parseDurationMs(session.pollingConfig?.pollInterval, 2000),
    });
  } catch (error: any) {
    console.error("Error polling Google Photos picker session:", error);
    return NextResponse.json({ error: error.message || "Failed to poll picker session" }, { status: 502 });
  }
}
