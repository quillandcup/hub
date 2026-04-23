import { createClient } from "@/lib/supabase/server";
import { GoogleCalendarClient } from "@/lib/google-calendar/client";
import { NextRequest, NextResponse } from "next/server";
import { triggerReprocessing } from "@/lib/processing/trigger";

// Extend timeout for syncing large calendars
export const maxDuration = 300; // 5 minutes (max for Hobby tier)

/**
 * Sync calendar events from Google Calendar to Bronze layer (idempotent)
 * Can be called regularly via cron or manually
 */
export async function POST(request: NextRequest) {
  const supabase = await createClient();

  // Check authentication
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { daysBack = 30, daysForward = 90 } = body;

    // Use environment variables for calendar config
    const calendarId = process.env.GOOGLE_CALENDAR_ID || "primary";

    // Initialize Google Calendar client (uses service account from env)
    const client = new GoogleCalendarClient();

    // Calculate date range (default: 30 days back, 90 days forward)
    const now = new Date();
    const fromDate = new Date(now);
    fromDate.setDate(fromDate.getDate() - daysBack);
    const toDate = new Date(now);
    toDate.setDate(toDate.getDate() + daysForward);

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

    // OPTIMIZATION: Load existing events in the sync date range
    // This is much more efficient than loading ALL events or using .in() with 1000+ IDs
    let existingEvents: any[] = [];
    let offset = 0;
    const FETCH_BATCH = 1000;
    let hasMore = true;

    while (hasMore) {
      const { data } = await supabase
        .from("bronze.calendar_events")
        .select("id, google_event_id, summary, start_time, end_time")
        .gte("start_time", timeMin)
        .lte("end_time", timeMax)
        .range(offset, offset + FETCH_BATCH - 1);

      if (data && data.length > 0) {
        existingEvents = existingEvents.concat(data);
        offset += data.length;
        hasMore = data.length === FETCH_BATCH;
      } else {
        hasMore = false;
      }
    }

    // Build lookup map by google_event_id for O(1) access
    const existingByGoogleId = new Map(
      (existingEvents || []).map((e) => [e.google_event_id, e])
    );

    let imported = 0;
    let updated = 0;
    let skipped = 0;

    const eventsToInsert: any[] = [];
    const eventsToUpdate: Array<{ id: string; data: any }> = [];

    // Process all events in memory first
    for (const event of events) {
      // Skip events without start/end times (all-day events, etc.)
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
        raw_data: event, // Store full event data
      };

      const existingEvent = existingByGoogleId.get(event.id);

      if (existingEvent) {
        // Check if changed (normalize timestamps for comparison)
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

    // Batch insert new events (use UPSERT to handle race conditions)
    if (eventsToInsert.length > 0) {
      const { error: insertError } = await supabase
        .from("bronze.calendar_events")
        .upsert(eventsToInsert, {
          onConflict: 'google_event_id',
          ignoreDuplicates: false, // Update if exists
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
    // This ensures the hygiene dashboard shows accurate "last sync" even if no events changed
    if (events.length > 0) {
      const googleEventIds = events.map(e => e.id);
      const { error: touchError } = await supabase
        .from("bronze.calendar_events")
        .update({ imported_at: new Date().toISOString() })
        .in("google_event_id", googleEventIds);

      if (touchError) {
        console.warn("Failed to update imported_at timestamps:", touchError);
        // Don't fail the sync for this
      }
    }

    // Batch update changed events
    // Note: Supabase doesn't support batch UPDATE with different values,
    // so we do individual updates but in parallel
    if (eventsToUpdate.length > 0) {
      const updatePromises = eventsToUpdate.map(({ id, data }) =>
        supabase.from("calendar_events").update(data).eq("id", id)
      );

      const results = await Promise.all(updatePromises);
      const errors = results.filter((r) => r.error);

      if (errors.length > 0) {
        console.error(`Failed to update ${errors.length} events`);
      }

      updated = eventsToUpdate.length - errors.length;
      skipped += errors.length;
    }

    // Trigger downstream Silver layer reprocessing
    const processingResult = await triggerReprocessing('calendar_events', 'bronze', {
      dateRange: {
        from: fromDate,
        to: toDate
      }
    });

    return NextResponse.json({
      success: true,
      total: events.length,
      imported,
      updated,
      skipped,
      dateRange: {
        from: fromDate.toISOString(),
        to: toDate.toISOString(),
      },
      processing: processingResult,
    });
  } catch (error: any) {
    console.error("Error syncing calendar:", error);
    return NextResponse.json(
      { error: error.message || "Failed to sync calendar" },
      { status: 500 }
    );
  }
}
