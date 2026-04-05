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

    // Step 1: Group attendees by meeting and find/create prickles
    const meetingsByUuid = new Map<string, any[]>();
    for (const attendee of zoomAttendees) {
      const uuid = attendee.meeting_uuid || attendee.meeting_id;
      if (!meetingsByUuid.has(uuid)) {
        meetingsByUuid.set(uuid, []);
      }
      meetingsByUuid.get(uuid)!.push(attendee);
    }

    const pricklesByMeetingUuid = new Map<string, string>();
    let matchedToCalendar = 0;
    let createdNewPrickles = 0;

    for (const [meetingUuid, attendees] of meetingsByUuid) {
      // Calculate meeting window from all attendees
      const joinTimes = attendees.map(a => new Date(a.join_time).getTime());
      const leaveTimes = attendees.map(a => new Date(a.leave_time).getTime());
      const meetingStart = new Date(Math.min(...joinTimes)).toISOString();
      const meetingEnd = new Date(Math.max(...leaveTimes)).toISOString();

      // Check if prickle already exists for this Zoom meeting
      const { data: existingPrickle } = await supabase
        .from("prickles")
        .select("id")
        .eq("zoom_meeting_uuid", meetingUuid)
        .single();

      if (existingPrickle) {
        pricklesByMeetingUuid.set(meetingUuid, existingPrickle.id);
        continue;
      }

      // Try to find overlapping calendar prickle (15min threshold)
      const calendarPrickleId = await findOverlappingPrickle(
        supabase,
        meetingStart,
        meetingEnd
      );

      if (calendarPrickleId) {
        // Match found - use calendar prickle
        pricklesByMeetingUuid.set(meetingUuid, calendarPrickleId);
        matchedToCalendar++;
        continue;
      }

      // No match found - create new Pop-Up Prickle (PUP)
      // Get Pop-Up Prickle type ID
      const { data: pupType } = await supabase
        .from("prickle_types")
        .select("id")
        .eq("normalized_name", "pop-up-prickle")
        .single();

      if (!pupType) {
        console.error("Pop-Up Prickle type not found in prickle_types");
        continue;
      }

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

      pricklesByMeetingUuid.set(meetingUuid, newPrickle.id);
      createdNewPrickles++;
    }

    // Step 2: Process individual attendees and create attendance records
    let attendanceRecords = 0;
    let matchedAttendees = 0;
    let skippedUnmatched = 0;

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

      const meetingUuid = attendee.meeting_uuid || attendee.meeting_id;
      const prickleId = pricklesByMeetingUuid.get(meetingUuid);

      if (!prickleId) {
        console.error(`No prickle found for meeting ${meetingUuid}`);
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
      meetingsProcessed: pricklesByMeetingUuid.size,
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
