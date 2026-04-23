import { createClient } from "@/lib/supabase/server";
import { GoogleCalendarClient } from "@/lib/google-calendar/client";
import { triggerReprocessing } from "@/lib/processing/trigger";
import { NextRequest, NextResponse } from "next/server";

/**
 * Import calendar events to Bronze layer (calendar_events table)
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
    const { calendarId, fromDate, toDate } = body;

    if (!fromDate || !toDate) {
      return NextResponse.json(
        { error: "fromDate and toDate are required" },
        { status: 400 }
      );
    }

    // Initialize Google Calendar client (uses service account from env)
    const client = new GoogleCalendarClient();

    // Fetch events from calendar
    const timeMin = new Date(fromDate).toISOString();
    const timeMax = new Date(toDate).toISOString();
    const useCalendarId = calendarId || process.env.GOOGLE_CALENDAR_ID || "primary";

    const events = await client.listEvents(useCalendarId, timeMin, timeMax);

    if (!events || events.length === 0) {
      return NextResponse.json({
        success: true,
        message: "No calendar events found in date range",
        imported: 0,
        updated: 0,
      });
    }

    let imported = 0;
    let updated = 0;
    let skipped = 0;

    // Import each event to Bronze (calendar_events table)
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

      // Upsert to Bronze (update if exists, insert if not)
      const { error: upsertError } = await supabase
        .from("bronze.calendar_events")
        .upsert(eventData, {
          onConflict: "google_event_id",
        });

      if (upsertError) {
        console.error("Error upserting calendar event:", upsertError);
        skipped++;
        continue;
      }

      // Check if this was an update or insert
      const { data: existing } = await supabase
        .from("calendar_events")
        .select("id")
        .eq("google_event_id", event.id)
        .single();

      if (existing) {
        updated++;
      } else {
        imported++;
      }
    }

    // Auto-trigger downstream Silver layer processing
    console.log(`Triggering downstream processing for date range ${fromDate} to ${toDate}`);
    const processingResult = await triggerReprocessing('calendar_events', 'bronze', {
      dateRange: {
        from: new Date(fromDate),
        to: new Date(toDate)
      }
    });

    return NextResponse.json({
      success: true,
      total: events.length,
      imported,
      updated,
      skipped,
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
