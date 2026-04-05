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
    const { calendarId, fromDate, toDate, refreshToken } = body;

    if (!fromDate || !toDate) {
      return NextResponse.json(
        { error: "fromDate and toDate are required" },
        { status: 400 }
      );
    }

    // Initialize Google Calendar client
    const client = new GoogleCalendarClient();

    // Use refresh token if provided, otherwise use env variable
    const token = refreshToken || process.env.GOOGLE_REFRESH_TOKEN;
    if (!token) {
      return NextResponse.json(
        { error: "No Google Calendar refresh token available. Please authenticate first." },
        { status: 400 }
      );
    }

    client.setTokens({ refresh_token: token });

    // Fetch events from calendar
    const timeMin = new Date(fromDate).toISOString();
    const timeMax = new Date(toDate).toISOString();
    const useCalendarId = calendarId || "primary";

    const events = await client.listEvents(useCalendarId, timeMin, timeMax);

    if (!events || events.length === 0) {
      return NextResponse.json({
        success: true,
        message: "No calendar events found in date range",
        imported: 0,
      });
    }

    let imported = 0;
    let skipped = 0;

    // Import each event as a prickle
    for (const event of events) {
      // Skip events without start/end times (all-day events, etc.)
      if (!event.start?.dateTime || !event.end?.dateTime) {
        skipped++;
        continue;
      }

      // Check if prickle already exists for this calendar event
      const { data: existingPrickle } = await supabase
        .from("prickles")
        .select("id")
        .eq("google_calendar_event_id", event.id)
        .single();

      if (existingPrickle) {
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

      // Insert prickle
      const { error: insertError } = await supabase.from("prickles").insert({
        title: event.summary || "Untitled Event",
        host,
        start_time: event.start.dateTime,
        end_time: event.end.dateTime,
        type: "Calendar Event",
        source: "google_calendar",
        google_calendar_event_id: event.id,
      });

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
