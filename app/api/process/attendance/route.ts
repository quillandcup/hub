import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";

// Extend timeout for processing large batches of attendance records
export const maxDuration = 60; // 60 seconds (max for Hobby tier)

/**
 * Find all calendar prickles that overlap with a time range
 */
async function findOverlappingPrickles(
  supabase: any,
  start: string,
  end: string
): Promise<any[]> {
  const { data: prickles } = await supabase
    .from("prickles")
    .select("id, start_time, end_time, type_id")
    .eq("source", "calendar")
    .lt("start_time", end)
    .gt("end_time", start)
    .order("start_time", { ascending: true });

  return prickles || [];
}

/**
 * Split a Zoom meeting into segments (scheduled prickles + PUPs)
 * Based on Python implementation in zoom-analytics/analyzer.py
 */
function splitMeetingIntoSegments(
  meetingStart: Date,
  meetingEnd: Date,
  meetingUuid: string,
  scheduledPrickles: any[],
  pupTypeId: string
): any[] {
  const segments: any[] = [];
  const THRESHOLD_MS = 20 * 60 * 1000; // 20 minutes

  if (scheduledPrickles.length === 0) {
    // No scheduled prickles - entire meeting is a PUP
    return [{
      type: "pup",
      type_id: pupTypeId,
      start_time: meetingStart.toISOString(),
      end_time: meetingEnd.toISOString(),
      zoom_meeting_uuid: meetingUuid,
    }];
  }

  let lastEndTime: Date | null = null;

  for (let i = 0; i < scheduledPrickles.length; i++) {
    const prickle = scheduledPrickles[i];
    const scheduledStart = new Date(prickle.start_time);
    const scheduledEnd = new Date(prickle.end_time);

    let segmentStart = meetingStart;
    let segmentEnd = meetingEnd;
    let pupAfter = false;

    // Rule 1 & 3: First prickle starts at meeting start, others start at scheduled time
    if (i !== 0) {
      segmentStart = scheduledStart;
    } else if (scheduledStart.getTime() - meetingStart.getTime() > THRESHOLD_MS) {
      // Rule 6: If >20 min early, create PUP before
      segmentStart = scheduledStart;
      segments.push({
        type: "pup",
        type_id: pupTypeId,
        start_time: meetingStart.toISOString(),
        end_time: scheduledStart.toISOString(),
        zoom_meeting_uuid: meetingUuid,
      });
    }

    // Rule 2 & 4: Last prickle ends at meeting end, others end at scheduled time
    if (i !== scheduledPrickles.length - 1) {
      segmentEnd = scheduledEnd;
    } else if (meetingEnd.getTime() - scheduledEnd.getTime() > THRESHOLD_MS) {
      // Rule 7: If >20 min late, create PUP after
      segmentEnd = scheduledEnd;
      pupAfter = true;
    }

    // Rule 5: Gap between prickles (only if there's a forward gap)
    if (lastEndTime && segmentStart.getTime() > lastEndTime.getTime()) {
      segments.push({
        type: "pup",
        type_id: pupTypeId,
        start_time: lastEndTime.toISOString(),
        end_time: segmentStart.toISOString(),
        zoom_meeting_uuid: meetingUuid,
      });
    }

    lastEndTime = segmentEnd;

    // Add scheduled prickle segment
    segments.push({
      type: "calendar",
      prickle_id: prickle.id,
      start_time: segmentStart.toISOString(),
      end_time: segmentEnd.toISOString(),
      zoom_meeting_uuid: meetingUuid,
    });

    // Rule 7: PUP after last scheduled prickle
    if (pupAfter) {
      segments.push({
        type: "pup",
        type_id: pupTypeId,
        start_time: scheduledEnd.toISOString(),
        end_time: meetingEnd.toISOString(),
        zoom_meeting_uuid: meetingUuid,
      });
    }
  }

  return segments;
}

/**
 * Calculate intersection of two time ranges
 */
function timeIntersection(
  start1: Date,
  end1: Date,
  start2: Date,
  end2: Date
): { start: Date; end: Date } | null {
  const intersectStart = new Date(Math.max(start1.getTime(), start2.getTime()));
  const intersectEnd = new Date(Math.min(end1.getTime(), end2.getTime()));

  if (intersectStart < intersectEnd) {
    return { start: intersectStart, end: intersectEnd };
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

    // Get Pop-Up Prickle type ID
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

    // STEP 1: Group attendees by meeting_uuid
    const meetingsByUuid = new Map<string, any[]>();
    for (const attendee of zoomAttendees) {
      const uuid = attendee.meeting_uuid || attendee.meeting_id;
      if (!meetingsByUuid.has(uuid)) {
        meetingsByUuid.set(uuid, []);
      }
      meetingsByUuid.get(uuid)!.push(attendee);
    }

    // STEP 2: Process each meeting - split into segments (scheduled + PUPs)
    const segmentsByMeeting = new Map<string, any[]>();

    for (const [meetingUuid, attendees] of meetingsByUuid) {
      // Calculate meeting window from ALL attendees
      const joinTimes = attendees.map(a => new Date(a.join_time));
      const leaveTimes = attendees.map(a => new Date(a.leave_time));
      const meetingStart = new Date(Math.min(...joinTimes.map(d => d.getTime())));
      const meetingEnd = new Date(Math.max(...leaveTimes.map(d => d.getTime())));

      // Find overlapping scheduled prickles
      const scheduledPrickles = await findOverlappingPrickles(
        supabase,
        meetingStart.toISOString(),
        meetingEnd.toISOString()
      );

      // Split meeting into segments
      const segments = splitMeetingIntoSegments(
        meetingStart,
        meetingEnd,
        meetingUuid,
        scheduledPrickles,
        pupType.id
      );

      segmentsByMeeting.set(meetingUuid, segments);
    }

    // STEP 3: Create prickles for PUP segments
    const prickleIdsBySegment = new Map<any, string>();

    for (const segments of segmentsByMeeting.values()) {
      for (const segment of segments) {
        if (segment.type === "calendar") {
          // Already exists - just map it
          prickleIdsBySegment.set(segment, segment.prickle_id);
          matchedToCalendar++; // Count segments, not attendees for now
        } else {
          // Create PUP
          const { data: newPrickle, error: prickleError } = await supabase
            .from("prickles")
            .insert({
              type_id: segment.type_id,
              host: null, // PUPs have no host
              start_time: segment.start_time,
              end_time: segment.end_time,
              source: "zoom",
              zoom_meeting_uuid: segment.zoom_meeting_uuid,
            })
            .select("id")
            .single();

          if (prickleError || !newPrickle) {
            console.error("Error creating PUP segment:", prickleError);
            continue;
          }

          prickleIdsBySegment.set(segment, newPrickle.id);
          createdNewPrickles++;
        }
      }
    }

    // STEP 4: Assign attendees to segments and create attendance records
    for (const [meetingUuid, attendees] of meetingsByUuid) {
      const segments = segmentsByMeeting.get(meetingUuid) || [];

      for (const attendee of attendees) {
        // Match attendee to member
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

        const attendeeStart = new Date(attendee.join_time);
        const attendeeEnd = new Date(attendee.leave_time);

        // Find which segment(s) this attendee intersects and calculate durations
        const intersections: Array<{
          segment: any;
          intersection: { start: Date; end: Date };
          durationMin: number;
          segmentIndex: number;
        }> = [];

        segments.forEach((segment, segmentIndex) => {
          const segmentStart = new Date(segment.start_time);
          const segmentEnd = new Date(segment.end_time);

          const intersection = timeIntersection(
            attendeeStart,
            attendeeEnd,
            segmentStart,
            segmentEnd
          );

          if (intersection) {
            const durationMs = intersection.end.getTime() - intersection.start.getTime();
            const durationMin = durationMs / (60 * 1000);

            intersections.push({
              segment,
              intersection,
              durationMin,
              segmentIndex,
            });
          }
        });

        // Filter out PUP attendance if person also attended adjacent scheduled prickle
        // (prevents double-counting someone who just showed up early/late)
        const filteredIntersections = intersections.filter((item, index) => {
          // If not a PUP, always count it
          if (item.segment.type !== "pup") return true;

          // Check if there's an adjacent scheduled prickle attendance
          const prevIntersection = index > 0 ? intersections[index - 1] : null;
          const nextIntersection = index < intersections.length - 1 ? intersections[index + 1] : null;

          const hasAdjacentScheduled =
            (prevIntersection && prevIntersection.segment.type === "calendar") ||
            (nextIntersection && nextIntersection.segment.type === "calendar");

          // If attending adjacent scheduled prickle, only count PUP if substantial (>15 min)
          if (hasAdjacentScheduled && item.durationMin < 15) {
            return false;
          }

          return true;
        });

        // Create attendance records
        for (const item of filteredIntersections) {
          const prickleId = prickleIdsBySegment.get(item.segment);
          if (!prickleId) continue;

          const { error: attendanceError } = await supabase
            .from("attendance")
            .upsert({
              member_id: match.member_id,
              prickle_id: prickleId,
              join_time: item.intersection.start.toISOString(),
              leave_time: item.intersection.end.toISOString(),
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
      }
    }

    return NextResponse.json({
      success: true,
      zoomAttendees: zoomAttendees.length,
      matchedAttendees,
      skippedUnmatched,
      meetingsProcessed: meetingsByUuid.size,
      segmentsCreated: matchedToCalendar + createdNewPrickles,
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
