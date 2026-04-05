import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";

/**
 * Find calendar prickle that overlaps with Zoom meeting (15min threshold)
 */
async function findOverlappingPrickle(
  supabase: any,
  meetingStart: string,
  meetingEnd: string
): Promise<string | null> {
  const OVERLAP_THRESHOLD_MS = 15 * 60 * 1000; // 15 minutes

  // Query calendar prickles that overlap with this time window
  // A prickle overlaps if: prickle_start < meeting_end AND prickle_end > meeting_start
  const { data: potentialMatches } = await supabase
    .from("prickles")
    .select("id, start_time, end_time")
    .eq("source", "calendar")
    .lte("start_time", meetingEnd)
    .gte("end_time", meetingStart);

  if (!potentialMatches || potentialMatches.length === 0) {
    return null;
  }

  // Calculate overlap duration for each potential match
  for (const prickle of potentialMatches) {
    const overlapStart = Math.max(
      new Date(meetingStart).getTime(),
      new Date(prickle.start_time).getTime()
    );
    const overlapEnd = Math.min(
      new Date(meetingEnd).getTime(),
      new Date(prickle.end_time).getTime()
    );

    const overlapMs = overlapEnd - overlapStart;

    if (overlapMs >= OVERLAP_THRESHOLD_MS) {
      return prickle.id; // Return first matching prickle
    }
  }

  return null;
}

/**
 * Process Bronze layer data (zoom_attendees + members) into Silver layer (attendance)
 *
 * This endpoint:
 * 1. Reads zoom_attendees (Bronze - raw Zoom data)
 * 2. Groups attendees by meeting_uuid to determine meeting window
 * 3. Matches Zoom meetings to calendar prickles using time overlap (15min threshold)
 * 4. Creates new prickles for unmatched Zoom meetings
 * 5. Matches each attendee to a member using match_member_by_name()
 * 6. Inserts attendance records (Silver - inferred data)
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

    // Delete existing attendance records in this date range
    // This makes the process fully idempotent - we regenerate Silver layer from Bronze
    await supabase
      .from("attendance")
      .delete()
      .gte("join_time", fromDate)
      .lte("leave_time", toDate);

    // Delete existing Pop-Up Prickles in this date range
    // Calendar prickles are kept, but PUPs are regenerated
    await supabase
      .from("prickles")
      .delete()
      .eq("source", "zoom")
      .gte("start_time", fromDate)
      .lte("end_time", toDate);

    // Get Pop-Up Prickle type ID (needed for creating PUPs later)
    const { data: pupType } = await supabase
      .from("prickle_types")
      .select("id")
      .eq("normalized_name", "pop-up")
      .single();

    if (!pupType) {
      return NextResponse.json(
        { error: "Pop-Up Prickle type not found in database" },
        { status: 500 }
      );
    }

    // Track stats
    let attendanceRecords = 0;
    let matchedAttendees = 0;
    let skippedUnmatched = 0;
    let matchedToCalendar = 0;
    let createdNewPrickles = 0;

    // Cache PUPs by meeting_uuid to avoid creating duplicates for same Zoom meeting
    const pupByMeetingUuid = new Map<string, string>(); // meeting_uuid -> prickle_id

    // Group attendees by meeting_uuid to calculate meeting windows for PUPs
    const attendeesByMeeting = new Map<string, any[]>();
    for (const attendee of zoomAttendees) {
      const uuid = attendee.meeting_uuid || attendee.meeting_id;
      if (!attendeesByMeeting.has(uuid)) {
        attendeesByMeeting.set(uuid, []);
      }
      attendeesByMeeting.get(uuid)!.push(attendee);
    }

    // Process each attendee individually
    for (const attendee of zoomAttendees) {
      // Match attendee to a member first
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

      // Try to find overlapping calendar prickle using THIS ATTENDEE'S join/leave window
      const attendeeStart = attendee.join_time;
      const attendeeEnd = attendee.leave_time;

      let prickleId = await findOverlappingPrickle(
        supabase,
        attendeeStart,
        attendeeEnd
      );

      if (prickleId) {
        matchedToCalendar++;
      } else {
        // No calendar match - create or find PUP for the MEETING (not individual attendee)
        const meetingUuid = attendee.meeting_uuid || attendee.meeting_id;

        if (pupByMeetingUuid.has(meetingUuid)) {
          // Already created PUP for this meeting
          prickleId = pupByMeetingUuid.get(meetingUuid)!;
        } else {
          // Calculate meeting window from all attendees in this meeting
          const meetingAttendees = attendeesByMeeting.get(meetingUuid) || [];
          const joinTimes = meetingAttendees.map(a => new Date(a.join_time).getTime());
          const leaveTimes = meetingAttendees.map(a => new Date(a.leave_time).getTime());
          const meetingStart = new Date(Math.min(...joinTimes)).toISOString();
          const meetingEnd = new Date(Math.max(...leaveTimes)).toISOString();

          // Check if PUP already exists for this meeting
          const { data: existingPup } = await supabase
            .from("prickles")
            .select("id")
            .eq("source", "zoom")
            .eq("zoom_meeting_uuid", meetingUuid)
            .single();

          if (existingPup) {
            prickleId = existingPup.id;
            pupByMeetingUuid.set(meetingUuid, prickleId);
          } else {
            // Create new PUP for the entire meeting window
            const { data: newPrickle, error: prickleError } = await supabase
              .from("prickles")
              .insert({
                type_id: pupType.id,
                host: "Unknown",
                start_time: meetingStart,
                end_time: meetingEnd,
                source: "zoom",
                zoom_meeting_uuid: meetingUuid,
              })
              .select("id")
              .single();

            if (prickleError || !newPrickle) {
              console.error("Error creating prickle:", prickleError);
              continue;
            }

            prickleId = newPrickle.id;
            pupByMeetingUuid.set(meetingUuid, prickleId);
            createdNewPrickles++;
          }
        }
      }

      if (!prickleId) {
        console.error(`No prickle found for attendee ${attendee.name}`);
        continue;
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
      matchedToCalendar,
      createdNewPrickles,
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
