import { createClient } from "@/lib/supabase/server";
import { GoogleCalendarClient } from "@/lib/google-calendar/client";
import { NextRequest, NextResponse } from "next/server";

/**
 * Import prickles from Google Calendar
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

    // Import/update each event as a prickle
    for (const event of events) {
      // Skip events without start/end times (all-day events, etc.)
      if (!event.start?.dateTime || !event.end?.dateTime) {
        skipped++;
        continue;
      }

      // Extract host from event creator or organizer
      const host =
        event.creator?.displayName ||
        event.creator?.email ||
        event.organizer?.displayName ||
        event.organizer?.email ||
        "Unknown";

      const prickleData = {
        title: event.summary || "Untitled Event",
        host,
        start_time: event.start.dateTime,
        end_time: event.end.dateTime,
        type: "Calendar Event",
        source: "calendar",
        google_calendar_event_id: event.id,
      };

      // Check if prickle already exists
      const { data: existingPrickle } = await supabase
        .from("prickles")
        .select("id, title, start_time, end_time")
        .eq("google_calendar_event_id", event.id)
        .single();

      if (existingPrickle) {
        // Update if details changed
        const changed =
          existingPrickle.title !== prickleData.title ||
          existingPrickle.start_time !== prickleData.start_time ||
          existingPrickle.end_time !== prickleData.end_time;

        if (changed) {
          const { error: updateError } = await supabase
            .from("prickles")
            .update(prickleData)
            .eq("id", existingPrickle.id);

          if (updateError) {
            console.error("Error updating prickle:", updateError);
            skipped++;
            continue;
          }
          updated++;
        } else {
          skipped++;
        }
        continue;
      }

      // Insert new prickle
      const { error: insertError } = await supabase
        .from("prickles")
        .insert(prickleData);

      if (insertError) {
        console.error("Error inserting prickle:", insertError);
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
    });
  } catch (error: any) {
    console.error("Error importing calendar events:", error);
    return NextResponse.json(
      { error: error.message || "Failed to import calendar events" },
      { status: 500 }
    );
  }
}
