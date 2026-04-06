import { createClient } from "@/lib/supabase/server";
import { GoogleCalendarClient } from "@/lib/google-calendar/client";
import { NextRequest, NextResponse } from "next/server";

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

    let imported = 0;
    let updated = 0;
    let skipped = 0;

    // Import/update each event to Bronze (calendar_events table)
    // Note: Google Calendar API handles pagination internally via listEvents
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

      // Check if event already exists
      const { data: existingEvent } = await supabase
        .from("calendar_events")
        .select("id, summary, start_time, end_time")
        .eq("google_event_id", event.id)
        .single();

      if (existingEvent) {
        // Update if details changed
        // Normalize timestamps for comparison (both to ISO strings)
        const existingStart = new Date(existingEvent.start_time).toISOString();
        const existingEnd = new Date(existingEvent.end_time).toISOString();
        const newStart = new Date(eventData.start_time).toISOString();
        const newEnd = new Date(eventData.end_time).toISOString();

        const changed =
          existingEvent.summary !== eventData.summary ||
          existingStart !== newStart ||
          existingEnd !== newEnd;

        if (changed) {
          const { error: updateError } = await supabase
            .from("calendar_events")
            .update(eventData)
            .eq("id", existingEvent.id);

          if (updateError) {
            console.error("Error updating calendar event:", updateError);
            skipped++;
            continue;
          }
          updated++;
        } else {
          skipped++;
        }
        continue;
      }

      // Insert new event
      const { error: insertError } = await supabase
        .from("calendar_events")
        .insert(eventData);

      if (insertError) {
        console.error("Error inserting calendar event:", insertError);
        skipped++;
        continue;
      }

      imported++;
    }

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
    });
  } catch (error: any) {
    console.error("Error syncing calendar:", error);
    return NextResponse.json(
      { error: error.message || "Failed to sync calendar" },
      { status: 500 }
    );
  }
}
