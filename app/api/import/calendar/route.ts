import { requireAdmin } from "@/lib/supabase/api-auth";
import { GoogleCalendarClient } from "@/lib/google-calendar/client";
import { NextRequest, NextResponse } from "next/server";
import { triggerReprocessing } from "@/lib/processing/trigger";
import { createClient as createDirectClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/data/database.types";
import type { CalendarSourceEvent } from "@/lib/data/calendar-events";
import { createRepos } from "@/lib/data/repos";

// Extend timeout for syncing large calendars
export const maxDuration = 300; // 5 minutes (max for Hobby tier)

/**
 * Import calendar events from Google Calendar to Bronze layer (idempotent).
 * Called by the admin form (POST with explicit fromDate/toDate) and internally
 * by triggerCalendarSync (which also passes daysBack/daysForward as fallback).
 */
export async function POST(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (!auth.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (auth.forbidden) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  // Use service role for all bronze DB operations in this route.
  // The authenticated (cookie-based) client silently fails on bronze schema SELECT and UPDATE
  // even though UPSERT works — the root cause is undiagnosed but consistent. Since this is
  // an admin-only route, service role is appropriate and correct throughout.
  const supabase = createDirectClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  try {
    const parsed = await request.json().catch(() => undefined);
    if (parsed === undefined) return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    const body = parsed;
    // Accept either explicit fromDate/toDate strings (from the admin form)
    // or relative daysBack/daysForward (from triggerCalendarSync / webhooks).
    const { daysBack = 30, daysForward = 90, fromDate: fromDateStr, toDate: toDateStr } = body;

    const calendarId = process.env.GOOGLE_CALENDAR_ID || "primary";
    const client = new GoogleCalendarClient();

    // Calculate date range: explicit strings take precedence over relative days
    const now = new Date();
    const fromDate = fromDateStr ? new Date(fromDateStr) : (() => { const d = new Date(now); d.setDate(d.getDate() - daysBack); return d; })();
    const toDate = toDateStr ? new Date(toDateStr) : (() => { const d = new Date(now); d.setDate(d.getDate() + daysForward); return d; })();

    const timeMin = fromDate.toISOString();
    const timeMax = toDate.toISOString();

    const events = await client.listEvents(calendarId, timeMin, timeMax);

    if (!events || events.length === 0) {
      return NextResponse.json({
        success: true,
        message: "No calendar events found in date range",
        imported: 0,
        updated: 0,
        skipped: 0,
      });
    }

    // Load existing events in the sync date range to detect changes and skips.
    // Note: uses service role so SELECT is reliable (unlike the cookie-based client).
    const calendar = createRepos(supabase).calendarEvents;
    let existingEvents: CalendarSourceEvent[] = [];
    try {
      existingEvents = await calendar.startingBetween(timeMin, timeMax);
    } catch (fetchError) {
      // Without them every item looks new; the upsert below is idempotent, so carry on.
      console.error("Error fetching existing bronze calendar events:", fetchError);
    }

    const existingByGoogleId = new Map(
      (existingEvents || []).map((e) => [e.google_event_id, e])
    );

    let imported = 0;
    let updated = 0;
    let skipped = 0;
    let deleted = 0;

    const eventsToInsert: any[] = [];
    const eventsToUpdate: Array<{ id: string; data: any }> = [];

    for (const event of events) {
      if (!event.start?.dateTime || !event.end?.dateTime) {
        skipped++;
        continue;
      }

      const eventData = {
        google_event_id: event.id,
        summary: event.summary || null,
        description: event.description || null,
        location: event.location || null,
        start_time: event.start.dateTime,
        end_time: event.end.dateTime,
        creator_email: event.creator?.email || null,
        creator_name: event.creator?.displayName || null,
        organizer_email: event.organizer?.email || null,
        organizer_name: event.organizer?.displayName || null,
        raw_data: event,
      };

      const existingEvent = existingByGoogleId.get(event.id);

      if (existingEvent) {
        const existingStart = new Date(existingEvent.start_time).toISOString();
        const existingEnd = new Date(existingEvent.end_time).toISOString();
        const newStart = new Date(eventData.start_time).toISOString();
        const newEnd = new Date(eventData.end_time).toISOString();

        const changed =
          existingEvent.summary !== eventData.summary ||
          existingStart !== newStart ||
          existingEnd !== newEnd;

        if (changed) {
          eventsToUpdate.push({
            id: existingEvent.id,
            data: { ...eventData, imported_at: new Date().toISOString() }
          });
        } else {
          skipped++;
        }
      } else {
        eventsToInsert.push(eventData);
      }
    }

    // Delete bronze records in the sync range that no longer exist in Google Calendar.
    // Uses a SECURITY DEFINER SQL function so it works regardless of caller identity.
    // ON DELETE CASCADE on unmatched_calendar_events.calendar_event_id means only truly
    // stale events are removed; UPSERT below preserves UUIDs for events that still exist.
    const currentGoogleIds = events
      .filter(e => e.start?.dateTime && e.id)
      .map(e => e.id as string)
      .filter(Boolean);

    if (currentGoogleIds.length > 0) {
      try {
        const deletedCount = await calendar.deleteStale({ from: timeMin, to: timeMax }, currentGoogleIds);
        if (deletedCount > 0) {
          console.log(`Deleted ${deletedCount} stale bronze calendar events no longer in Google Calendar`);
          deleted = deletedCount;
        }
      } catch (deleteStaleError) {
        console.error("Error deleting stale calendar events via RPC:", deleteStaleError);
      }
    }

    if (eventsToInsert.length > 0) {
      try {
        await calendar.upsert(eventsToInsert);
      } catch (insertError) {
        console.error("Error inserting calendar events:", insertError);
        return NextResponse.json(
          { error: "Failed to insert calendar events" },
          { status: 500 }
        );
      }
      imported = eventsToInsert.length;
    }

    // Touch imported_at on all synced events to track last sync time
    if (events.length > 0) {
      try {
        await calendar.touchImported(events.map(e => e.id as string), new Date().toISOString());
      } catch (touchError) {
        console.warn("Failed to update imported_at timestamps batch:", touchError);
      }
    }

    if (eventsToUpdate.length > 0) {
      const results = await Promise.allSettled(eventsToUpdate.map(({ id, data }) => calendar.update(id, data)));
      const errors = results.filter((r) => r.status === "rejected");

      if (errors.length > 0) {
        console.error(`Failed to update ${errors.length} events`);
      }

      updated = eventsToUpdate.length - errors.length;
      skipped += errors.length;
    }

    const processingResult = await triggerReprocessing('calendar_events', 'bronze', {
      dateRange: { from: fromDate, to: toDate }
    });

    return NextResponse.json({
      success: true,
      total: events.length,
      imported,
      updated,
      deleted,
      skipped,
      dateRange: {
        from: fromDate.toISOString(),
        to: toDate.toISOString(),
      },
      processing: processingResult,
    });
  } catch (error: any) {
    console.error("Error importing calendar events:", error);
    return NextResponse.json(
      { error: error.message || "Failed to import calendar events" },
      { status: 500 }
    );
  }
}
