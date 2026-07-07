import { requireAdmin } from "@/lib/supabase/api-auth";
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
  const auth = await requireAdmin(request);
  if (!auth.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (auth.forbidden) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { supabase } = auth;

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

    // Load existing events in the sync date range to detect changes and skips.
    // Note: this SELECT sometimes returns empty for authenticated (cookie-based) callers
    // due to a permission issue we haven't fully diagnosed. Stale deletion is handled by
    // the delete_stale_calendar_events() RPC below, which uses SECURITY DEFINER and always
    // works. If this SELECT returns an error, log it but continue — the UPSERT path below
    // is idempotent and correct regardless.
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
        console.error("Error fetching existing bronze calendar events (stale detection skipped):", fetchError);
        hasMore = false;
      } else if (data && data.length > 0) {
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
    let deleted = 0;

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

    // Delete bronze records in the sync range that no longer exist in Google Calendar.
    // Uses a SECURITY DEFINER SQL function so it works for both cookie-based admin sessions
    // and cron/service-role callers — the JS-side SELECT above can silently fail for
    // authenticated users, but the RPC always succeeds.
    // ON DELETE CASCADE on unmatched_calendar_events.calendar_event_id means only truly
    // stale events (not in current Google Calendar) are removed; UPSERT below preserves
    // UUIDs for events that still exist, keeping any admin-set resolved_type_id intact.
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

    // Batch insert new events (use UPSERT to handle race conditions)
    if (eventsToInsert.length > 0) {
      const { error: insertError } = await supabase
        .schema('bronze').from("calendar_events")
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
      const UPDATE_BATCH = 100; // Batch to avoid "URI too long" errors

      for (let i = 0; i < googleEventIds.length; i += UPDATE_BATCH) {
        const batch = googleEventIds.slice(i, i + UPDATE_BATCH);
        const { error: touchError } = await supabase
          .schema('bronze').from("calendar_events")
          .update({ imported_at: new Date().toISOString() })
          .in("google_event_id", batch);

        if (touchError) {
          console.warn("Failed to update imported_at timestamps batch:", touchError);
          // Don't fail the sync for this
        }
      }
    }

    // Batch update changed events
    // Note: Supabase doesn't support batch UPDATE with different values,
    // so we do individual updates but in parallel
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
      deleted,
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
