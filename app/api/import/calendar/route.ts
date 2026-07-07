import { requireAdmin } from "@/lib/supabase/api-auth";
import { GoogleCalendarClient } from "@/lib/google-calendar/client";
import { NextRequest, NextResponse } from "next/server";
import { triggerReprocessing } from "@/lib/processing/trigger";
import { createClient as createDirectClient } from "@supabase/supabase-js";

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
  const supabase = createDirectClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  try {
    const body = await request.json();
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
    let existingEvents: any[] = [];
    let offset = 0;
    const FETCH_BATCH = 1000;
    let hasMore = true;

    while (hasMore) {
      const { data, error: fetchError } = await supabase
        .schema('bronze').from("calendar_events")
        .select("id, google_event_id, summary, start_time, end_time")
        .gte("start_time", timeMin)
        .lte("start_time", timeMax)
        .range(offset, offset + FETCH_BATCH - 1);

      if (fetchError) {
        console.error("Error fetching existing bronze calendar events:", fetchError);
        hasMore = false;
      } else if (data && data.length > 0) {
        existingEvents = existingEvents.concat(data);
        offset += data.length;
        hasMore = data.length === FETCH_BATCH;
      } else {
        hasMore = false;
      }
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
      const { data: deletedCount, error: deleteStaleError } = await supabase
        .rpc('delete_stale_calendar_events', {
          p_time_min: timeMin,
          p_time_max: timeMax,
          p_current_google_ids: currentGoogleIds,
        });
      if (deleteStaleError) {
        console.error("Error deleting stale calendar events via RPC:", deleteStaleError);
      } else if (deletedCount > 0) {
        console.log(`Deleted ${deletedCount} stale bronze calendar events no longer in Google Calendar`);
        deleted = deletedCount as number;
      }
    }

    if (eventsToInsert.length > 0) {
      const { error: insertError } = await supabase
        .schema('bronze').from("calendar_events")
        .upsert(eventsToInsert, {
          onConflict: 'google_event_id',
          ignoreDuplicates: false,
        });

      if (insertError) {
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
      const googleEventIds = events.map(e => e.id);
      const UPDATE_BATCH = 100;

      for (let i = 0; i < googleEventIds.length; i += UPDATE_BATCH) {
        const batch = googleEventIds.slice(i, i + UPDATE_BATCH);
        const { error: touchError } = await supabase
          .schema('bronze').from("calendar_events")
          .update({ imported_at: new Date().toISOString() })
          .in("google_event_id", batch);

        if (touchError) {
          console.warn("Failed to update imported_at timestamps batch:", touchError);
        }
      }
    }

    if (eventsToUpdate.length > 0) {
      const updatePromises = eventsToUpdate.map(({ id, data }) =>
        supabase.schema('bronze').from("calendar_events").update(data).eq("id", id)
      );

      const results = await Promise.all(updatePromises);
      const errors = results.filter((r) => r.error);

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
