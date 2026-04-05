import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";

/**
 * Process Bronze layer (calendar_events) into Silver layer (prickles)
 *
 * This endpoint:
 * 1. Reads calendar_events (Bronze - raw Google Calendar data)
 * 2. Transforms data (extracts host from title, etc.)
 * 3. Upserts into prickles (Silver - canonical events)
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
    const { fromDate, toDate } = body;

    if (!fromDate || !toDate) {
      return NextResponse.json(
        { error: "fromDate and toDate are required" },
        { status: 400 }
      );
    }

    // Get calendar events from Bronze layer
    const { data: calendarEvents, error: fetchError } = await supabase
      .from("calendar_events")
      .select("*")
      .gte("start_time", fromDate)
      .lte("end_time", toDate)
      .order("start_time");

    if (fetchError) throw fetchError;

    if (!calendarEvents || calendarEvents.length === 0) {
      return NextResponse.json({
        success: true,
        message: "No calendar events found in date range",
        pricklesCreated: 0,
      });
    }

    let created = 0;
    let updated = 0;
    let skipped = 0;

    // Extract host from event title (e.g., "Prickle w/Lili" -> "Lili")
    const extractHostFromTitle = (title: string): string | null => {
      // Match patterns like "w/Name" or "w/ Name"
      const match = title.match(/\bw\/\s*([^,\n]+)/i);
      return match ? match[1].trim() : null;
    };

    // Process each calendar event into a prickle
    for (const event of calendarEvents) {
      const titleHost = event.summary ? extractHostFromTitle(event.summary) : null;
      const host = titleHost ||
        event.creator_name ||
        event.creator_email ||
        event.organizer_name ||
        event.organizer_email ||
        "Unknown";

      const prickleData = {
        title: event.summary || "Untitled Event",
        host,
        start_time: event.start_time,
        end_time: event.end_time,
        type: "Calendar Event",
        source: "calendar",
      };

      // Check if prickle already exists for this calendar event
      // Match by start_time, end_time, and source (since we can't use google_event_id anymore)
      const { data: existingPrickle } = await supabase
        .from("prickles")
        .select("id, title, host")
        .eq("start_time", event.start_time)
        .eq("end_time", event.end_time)
        .eq("source", "calendar")
        .eq("title", prickleData.title)
        .single();

      if (existingPrickle) {
        // Update if host changed (due to title extraction logic)
        if (existingPrickle.host !== prickleData.host) {
          const { error: updateError } = await supabase
            .from("prickles")
            .update({ host: prickleData.host })
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

      // Create new prickle
      const { error: insertError } = await supabase
        .from("prickles")
        .insert(prickleData);

      if (insertError) {
        console.error("Error creating prickle:", insertError);
        skipped++;
        continue;
      }

      created++;
    }

    return NextResponse.json({
      success: true,
      calendarEvents: calendarEvents.length,
      pricklesCreated: created,
      pricklesUpdated: updated,
      skipped,
    });
  } catch (error: any) {
    console.error("Error processing calendar events:", error);
    return NextResponse.json(
      { error: error.message || "Failed to process calendar events" },
      { status: 500 }
    );
  }
}
