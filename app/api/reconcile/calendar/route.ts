import { createClient } from "@/lib/supabase/server";
import { GoogleCalendarClient } from "@/lib/google-calendar/client";
import { triggerReprocessing } from "@/lib/processing/trigger";
import { NextRequest, NextResponse } from "next/server";

// Extend timeout for reconciliation jobs
export const maxDuration = 300; // 5 minutes (max for Hobby tier)

/**
 * Daily reconciliation job for calendar events
 * Fetches ALL calendar data from Google Calendar (last 90 days) and reprocesses Silver layer
 * This catches any webhooks that failed or were missed
 *
 * Scheduled to run daily at 2am via Vercel Cron
 */
export async function POST(request: NextRequest) {
  const supabase = await createClient();

  // Check authentication
  // For cron jobs, Vercel sends Authorization: Bearer <CRON_SECRET>
  // For manual testing, allow authenticated users
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Allow either cron secret or authenticated user
  const isAuthorizedCron = cronSecret && authHeader === `Bearer ${cronSecret}`;
  const isAuthenticatedUser = !!user;

  if (!isAuthorizedCron && !isAuthenticatedUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    // Use environment variables for calendar config
    const calendarId = process.env.GOOGLE_CALENDAR_ID || "primary";

    // Initialize Google Calendar client (uses service account from env)
    const client = new GoogleCalendarClient();

    // Fetch last 90 days (safety margin for reconciliation)
    const now = new Date();
    const fromDate = new Date(now);
    fromDate.setDate(fromDate.getDate() - 90);
    const toDate = new Date(now);

    const timeMin = fromDate.toISOString();
    const timeMax = toDate.toISOString();

    console.log(`[Reconciliation] Fetching calendar events from ${timeMin} to ${timeMax}`);

    // 1. Fetch ALL data from Google Calendar API
    const events = await client.listEvents(calendarId, timeMin, timeMax);

    console.log(`[Reconciliation] Found ${events.length} calendar events`);

    if (!events || events.length === 0) {
      return NextResponse.json({
        success: true,
        message: "No calendar events found in date range",
        imported: 0,
        updated: 0,
        skipped: 0,
      });
    }

    // 2. UPSERT to Bronze layer (idempotent)
    // Load existing events in the sync date range for change detection
    let existingEvents: any[] = [];
    let offset = 0;
    const FETCH_BATCH = 1000;
    let hasMore = true;

    while (hasMore) {
      const { data } = await supabase
        .schema('bronze')
        .from("calendar_events")
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
          updated++;
        } else {
          skipped++;
        }
      } else {
        imported++;
      }

      eventsToInsert.push(eventData);
    }

    // Batch UPSERT all events (idempotent)
    if (eventsToInsert.length > 0) {
      const { error: upsertError } = await supabase
        .schema('bronze')
        .from("calendar_events")
        .upsert(eventsToInsert, {
          onConflict: 'google_event_id',
          ignoreDuplicates: false, // Update if exists
        });

      if (upsertError) {
        console.error("[Reconciliation] Error upserting calendar events:", upsertError);
        return NextResponse.json(
          { error: "Failed to upsert calendar events" },
          { status: 500 }
        );
      }
    }

    console.log(`[Reconciliation] Bronze layer updated: ${imported} new, ${updated} updated, ${skipped} unchanged`);

    // 3. Trigger Silver layer processing
    console.log(`[Reconciliation] Triggering calendar processing for ${fromDate.toISOString()} to ${toDate.toISOString()}`);

    const processingResult = await triggerReprocessing('calendar_events', 'bronze', {
      dateRange: {
        from: fromDate,
        to: toDate
      }
    });

    console.log(`[Reconciliation] Calendar reconciliation complete`);

    return NextResponse.json({
      success: true,
      reconciliation: "calendar",
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
    console.error("[Reconciliation] Error in calendar reconciliation:", error);
    return NextResponse.json(
      { error: error.message || "Failed to reconcile calendar" },
      { status: 500 }
    );
  }
}
