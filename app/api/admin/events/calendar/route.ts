import { requireAdmin } from "@/lib/supabase/api-auth";
import { NextRequest, NextResponse } from "next/server";
import { elevateCalendarEvent } from "@/lib/calendar-events";
import { isUuid } from "@/lib/ids";

/** Shows a calendar item in Events: creates the event that follows it, or returns the one it has. */
export async function POST(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (!auth.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (auth.forbidden) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { supabase, user } = auth;

  const body = await request.json().catch(() => undefined);
  if (body === undefined) return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  if (!isUuid(body.calendarEventId)) return NextResponse.json({ error: "calendarEventId is required" }, { status: 400 });

  const result = await elevateCalendarEvent(supabase, body.calendarEventId, user.id === "service-role" || user.id === "cron" ? null : user.id);
  if (!result.ok) {
    if (result.status === 500) console.error("Error showing a calendar event in Events:", result.error);
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  return NextResponse.json({ event: result.event }, { status: result.created ? 201 : 200 });
}
