import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";

/**
 * Process Bronze layer data (zoom_attendees + members) into Silver layer (attendance)
 *
 * This endpoint:
 * 1. Reads zoom_attendees (Bronze - raw Zoom data)
 * 2. Matches each attendee to a member using match_member_by_name()
 * 3. Creates prickles from Zoom meetings (simplified - one meeting = one prickle for now)
 * 4. Inserts attendance records (Silver - inferred data)
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

    // Get all zoom attendees in date range
    const { data: zoomAttendees, error: zoomError } = await supabase
      .from("zoom_attendees")
      .select("*")
      .gte("join_time", fromDate)
      .lte("leave_time", toDate)
      .order("join_time");

    if (zoomError) throw zoomError;

    if (!zoomAttendees || zoomAttendees.length === 0) {
      return NextResponse.json({
        success: true,
        message: "No zoom attendees found in date range",
        attendanceRecords: 0,
      });
    }

    let attendanceRecords = 0;
    let matchedAttendees = 0;
    let skippedUnmatched = 0;
    const pricklesByMeetingUuid = new Map<string, string>(); // meeting_uuid -> prickle_id

    // Process each attendee
    for (const attendee of zoomAttendees) {
      // Match attendee to a member
      const { data: matchResult } = await supabase.rpc("match_member_by_name", {
        zoom_name: attendee.name,
        zoom_email: attendee.email,
      });

      const match = matchResult && matchResult.length > 0 ? matchResult[0] : null;

      if (!match) {
        skippedUnmatched++;
        continue;
      }

      matchedAttendees++;

      // Get or create prickle for this Zoom meeting
      let prickleId = pricklesByMeetingUuid.get(attendee.meeting_uuid);

      if (!prickleId) {
        // Check if prickle already exists for this Zoom meeting
        const { data: existingPrickle } = await supabase
          .from("prickles")
          .select("id")
          .eq("zoom_meeting_uuid", attendee.meeting_uuid)
          .single();

        if (existingPrickle) {
          prickleId = existingPrickle.id;
        } else {
          // Create prickle from Zoom meeting
          const { data: newPrickle, error: prickleError } = await supabase
            .from("prickles")
            .insert({
              title: attendee.topic || "Zoom Meeting",
              host: "Unknown", // TODO: extract from Zoom meeting host
              start_time: attendee.join_time,
              end_time: attendee.leave_time,
              type: "Zoom Meeting",
              source: "zoom",
              zoom_meeting_uuid: attendee.meeting_uuid,
            })
            .select("id")
            .single();

          if (prickleError || !newPrickle) {
            console.error("Error creating prickle:", prickleError);
            continue;
          }

          prickleId = newPrickle.id;
        }

        pricklesByMeetingUuid.set(attendee.meeting_uuid, prickleId);
      }

      // Create attendance record (Silver layer - inferred data)
      const { error: attendanceError } = await supabase
        .from("attendance")
        .upsert({
          member_id: match.member_id,
          prickle_id: prickleId,
          join_time: attendee.join_time,
          leave_time: attendee.leave_time,
          confidence_score: match.confidence,
        }, {
          onConflict: "member_id,prickle_id",
        });

      if (attendanceError) {
        console.error("Error creating attendance:", attendanceError);
        continue;
      }

      attendanceRecords++;
    }

    return NextResponse.json({
      success: true,
      zoomAttendees: zoomAttendees.length,
      matchedAttendees,
      skippedUnmatched,
      pricklesCreated: pricklesByMeetingUuid.size,
      attendanceRecords,
      matchRate: zoomAttendees.length > 0
        ? Math.round((matchedAttendees / zoomAttendees.length) * 100)
        : 0,
    });
  } catch (error: any) {
    console.error("Error processing attendance:", error);
    return NextResponse.json(
      { error: error.message || "Failed to process attendance" },
      { status: 500 }
    );
  }
}
