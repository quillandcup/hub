import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { parsePrickleFromSummary, matchPrickleType } from "@/lib/prickle-types";

/**
 * Process Bronze layer (calendar_events) into Silver layer (prickles)
 *
 * This endpoint:
 * 1. Reads calendar_events (Bronze - raw Google Calendar data)
 * 2. Parses prickle type and host from summary
 * 3. Matches to prickle_types or queues for admin review
 * 4. Upserts into prickles (Silver - canonical events)
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

    // Get calendar events from Bronze layer with pagination
    const BATCH_SIZE = 1000;
    let allEvents: any[] = [];
    let offset = 0;
    let hasMore = true;

    while (hasMore) {
      const { data: batch, error: fetchError } = await supabase
        .from("calendar_events")
        .select("*")
        .gte("start_time", fromDate)
        .lte("end_time", toDate)
        .order("start_time")
        .range(offset, offset + BATCH_SIZE - 1);

      if (fetchError) throw fetchError;

      if (batch && batch.length > 0) {
        allEvents = allEvents.concat(batch);
        offset += batch.length;
        hasMore = batch.length === BATCH_SIZE;
      } else {
        hasMore = false;
      }
    }

    if (allEvents.length === 0) {
      return NextResponse.json({
        success: true,
        message: "No calendar events found in date range",
        pricklesCreated: 0,
      });
    }

    let created = 0;
    let updated = 0;
    let skipped = 0;
    let queuedForReview = 0;

    // Process each calendar event into a prickle
    for (const event of allEvents) {
      if (!event.summary) {
        skipped++;
        continue;
      }

      // Parse prickle type and host from summary
      const { type: rawType, host: extractedHost } = parsePrickleFromSummary(event.summary);

      let host = extractedHost;
      let suggestedHost = event.creator_name || event.organizer_name || null;

      // If no host extracted from summary, try to match organizer/creator to a member
      if (!host && (event.organizer_name || event.creator_name)) {
        const nameToMatch = event.organizer_name || event.creator_name;
        const emailToMatch = event.organizer_email || event.creator_email || null;

        const { data: matchResult } = await supabase.rpc("match_member_by_name", {
          zoom_name: nameToMatch,
          zoom_email: emailToMatch,
        });

        const match = matchResult && matchResult.length > 0 ? matchResult[0] : null;

        if (match) {
          // Get the canonical member name
          const { data: member } = await supabase
            .from("members")
            .select("name")
            .eq("id", match.member_id)
            .single();

          if (member) {
            host = member.name;
            suggestedHost = member.name;
          }
        }
      }

      // Match to prickle type (only queue if we have no type at all)
      if (!rawType) {
        // No type could be extracted - queue for admin review
        await supabase
          .from("unmatched_calendar_events")
          .upsert({
            calendar_event_id: event.id,
            raw_summary: event.summary,
            suggested_type: null,
            suggested_host: suggestedHost,
            status: "pending",
          }, {
            onConflict: "calendar_event_id",
          });
        queuedForReview++;
        continue;
      }

      const typeId = await matchPrickleType(supabase, rawType);

      if (!typeId) {
        // Type extracted but not in prickle_types table - queue for admin review
        await supabase
          .from("unmatched_calendar_events")
          .upsert({
            calendar_event_id: event.id,
            raw_summary: event.summary,
            suggested_type: rawType,
            suggested_host: host,
            status: "pending",
          }, {
            onConflict: "calendar_event_id",
          });
        queuedForReview++;
        continue;
      }

      // Check if prickle already exists
      const { data: existingPrickle } = await supabase
        .from("prickles")
        .select("id, host, type_id")
        .eq("start_time", event.start_time)
        .eq("end_time", event.end_time)
        .eq("source", "calendar")
        .single();

      if (existingPrickle) {
        // Update if host or type changed
        if (existingPrickle.host !== host || existingPrickle.type_id !== typeId) {
          const { error: updateError } = await supabase
            .from("prickles")
            .update({ host, type_id: typeId })
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
        .insert({
          type_id: typeId,
          host,
          start_time: event.start_time,
          end_time: event.end_time,
          source: "calendar",
        });

      if (insertError) {
        console.error("Error creating prickle:", insertError);
        skipped++;
        continue;
      }

      created++;
    }

    return NextResponse.json({
      success: true,
      calendarEvents: allEvents.length,
      pricklesCreated: created,
      pricklesUpdated: updated,
      queuedForReview,
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
