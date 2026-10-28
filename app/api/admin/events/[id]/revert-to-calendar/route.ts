import { createRepos } from "@/lib/data/repos";
import { requireAdmin } from "@/lib/supabase/api-auth";
import { NextRequest, NextResponse } from "next/server";
import { calendarEventFields, syncCalendarEvent, syncableFields } from "@/lib/calendar-events";

/**
 * Makes an event that follows the calendar follow it again: clears the fields an admin changed and
 * takes title, description and location from the calendar as they are now.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin(request);
  if (!auth.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (auth.forbidden) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { supabase } = auth;
  const { id } = await params;

  const events = createRepos(supabase).events;
  let event;
  try {
    event = await events.byId(id);
  } catch (eventError) {
    console.error("Error loading event to revert to the calendar:", eventError);
    return NextResponse.json({ error: eventError instanceof Error ? eventError.message : "Failed to load event" }, { status: 500 });
  }
  if (!event) return NextResponse.json({ error: "Event not found" }, { status: 404 });
  if (!event.calendar_event_id) return NextResponse.json({ error: "This event doesn't follow the calendar" }, { status: 400 });

  let source;
  try {
    source = await createRepos(supabase).calendarEvents.byId(event.calendar_event_id);
  } catch (sourceError) {
    console.error("Error loading calendar event to revert to:", sourceError);
    return NextResponse.json({ error: (sourceError as Error).message }, { status: 500 });
  }
  if (!source) return NextResponse.json({ error: "The calendar event is gone" }, { status: 404 });

  let updated;
  try {
    updated = await events.edit(id, { ...syncableFields(calendarEventFields(source), []), overridden_fields: [] });
  } catch (error) {
    console.error("Error reverting event to the calendar:", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to revert event" }, { status: 500 });
  }
  // An event that stands for a prickle takes its title, description, guest speaker and host from it, not the calendar.
  await syncCalendarEvent(supabase, event.calendar_event_id);
  const synced = await events.byId(id).catch(() => null);
  return NextResponse.json({ event: synced ?? updated });
}
