import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { matchAttendeeToMember } from "@/lib/member-matching";

// Extend timeout for processing large batches of attendance records
export const maxDuration = 300; // 5 minutes

// Helper to normalize name for matching
function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// Helper to chunk array for batch processing
function chunk<T>(array: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
}

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
  // Check authentication (supports both cookie-based and service role key)
  const authHeader = request.headers.get('authorization');
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const isServiceRole = authHeader && serviceRoleKey && authHeader.includes(serviceRoleKey);

  let supabase;

  if (isServiceRole) {
    // Use service role client for tests
    const { createClient: createSupabaseClient } = await import('@supabase/supabase-js');
    supabase = createSupabaseClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      serviceRoleKey,
      { auth: { autoRefreshToken: false, persistSession: false } }
    );
  } else {
    // Use cookie-based client for normal requests
    supabase = await createClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
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

    // Normalize date strings to proper datetime boundaries for overlap queries
    // fromDate: use as-is (start of day if date-only)
    // toDate: if date-only, add 1 day to get start of next day
    // This ensures overlap logic catches records that cross boundaries
    const fromDateTime = fromDate.includes('T') ? fromDate : `${fromDate}T00:00:00Z`;
    const toDateTime = toDate.includes('T') ? toDate : (() => {
      const nextDay = new Date(toDate);
      nextDay.setDate(nextDay.getDate() + 1);
      return nextDay.toISOString().split('T')[0] + 'T00:00:00Z';
    })();

    console.log(`Date normalization: from ${fromDate} -> ${fromDateTime}, to ${toDate} -> ${toDateTime}`);

    // Get all zoom attendees that overlap the date range
    // Use overlap logic (start < rangeEnd AND end > rangeStart) to catch attendees
    // whose sessions span across date boundaries
    const { data: zoomAttendees, error: zoomError } = await supabase
      .schema('bronze').from("zoom_attendees")
      .select("*")
      .lt("join_time", toDateTime)
      .gt("leave_time", fromDateTime)
      .order("join_time");

    console.log(`Found ${zoomAttendees?.length || 0} zoom attendees in range`);

    if (zoomError) throw zoomError;

    if (!zoomAttendees || zoomAttendees.length === 0) {
      return NextResponse.json({
        success: true,
        message: "No zoom attendees found in date range",
        attendanceRecords: 0,
      });
    }

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

    // Load reference data upfront for in-memory matching (performance optimization)
    // Note: Load ALL calendar prickles that OVERLAP with date range (not just contained within)
    // A prickle overlaps if: prickle.start_time < toDate AND prickle.end_time > fromDate
    let allPrickles: any[] = [];
    let prickleOffset = 0;
    const PRICKLE_BATCH = 1000;
    let hasMorePrickles = true;

    while (hasMorePrickles) {
      const { data: batch } = await supabase
        .from("prickles")
        .select("id, start_time, end_time, type_id")
        .eq("source", "calendar")
        .lt("start_time", toDateTime)    // Prickle starts before end of range
        .gt("end_time", fromDateTime)    // Prickle ends after start of range
        .order("start_time")
        .range(prickleOffset, prickleOffset + PRICKLE_BATCH - 1);

      if (batch && batch.length > 0) {
        allPrickles = allPrickles.concat(batch);
        prickleOffset += batch.length;
        hasMorePrickles = batch.length === PRICKLE_BATCH;
      } else {
        hasMorePrickles = false;
      }
    }

    const [{ data: members }, { data: aliases }] = await Promise.all([
      supabase.from("members").select("id, name, email"),
      supabase.from("member_name_aliases").select("alias, member_id"),
    ]);

    // Helper to find overlapping prickles in memory
    function findOverlappingPricklesInMemory(start: string, end: string): any[] {
      return (allPrickles || []).filter((p) => p.start_time < end && p.end_time > start);
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
      // CRITICAL: Calculate meeting window from MATCHED attendees only
      // If we use all attendees (including unmatched), we create PUP segments
      // for time windows where only unmatched attendees were present,
      // resulting in 0-attendee PUPs
      const matchedAttendeesForWindow = attendees.filter(a => {
        const match = matchAttendeeToMember(a.name, a.email, members || [], aliases || []);
        return match !== null;
      });

      // Skip meetings where nobody matched (edge case)
      if (matchedAttendeesForWindow.length === 0) {
        continue;
      }

      const joinTimes = matchedAttendeesForWindow.map(a => new Date(a.join_time));
      const leaveTimes = matchedAttendeesForWindow.map(a => new Date(a.leave_time));
      const meetingStart = new Date(Math.min(...joinTimes.map(d => d.getTime())));
      const meetingEnd = new Date(Math.max(...leaveTimes.map(d => d.getTime())));

      // Find overlapping scheduled prickles (in memory for performance)
      const scheduledPrickles = findOverlappingPricklesInMemory(
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

    // STEP 3: Prepare PUP data (assign client-side temp IDs instead of creating them now)
    // We'll create them atomically with attendance later
    const prickleIdsBySegment = new Map<any, string>();
    const pupsToCreate: any[] = [];
    let clientPupIdCounter = 0;

    for (const segments of segmentsByMeeting.values()) {
      for (const segment of segments) {
        if (segment.type === "calendar") {
          // Already exists - just map it
          prickleIdsBySegment.set(segment, segment.prickle_id);
          matchedToCalendar++; // Count segments, not attendees for now
        } else {
          // Skip 0-duration PUP segments (edge case bug)
          const segmentStart = new Date(segment.start_time);
          const segmentEnd = new Date(segment.end_time);
          if (segmentStart.getTime() >= segmentEnd.getTime()) {
            console.warn(`Skipping 0-duration PUP segment: ${segment.start_time} - ${segment.end_time}`);
            continue;
          }

          // Assign a client-side temp ID for this PUP
          const clientPupId = `pup_${clientPupIdCounter++}`;
          prickleIdsBySegment.set(segment, clientPupId);

          // Add to PUPs to create atomically later
          pupsToCreate.push({
            client_prickle_id: clientPupId,
            type_id: segment.type_id,
            host: null, // PUPs have no host
            start_time: segment.start_time,
            end_time: segment.end_time,
            source: "zoom",
            zoom_meeting_uuid: segment.zoom_meeting_uuid,
          });

          createdNewPrickles++;
        }
      }
    }

    // STEP 4: Assign attendees to segments and collect attendance records
    const attendanceToUpsert: any[] = [];
    let segmentLookupFailures = 0;

    for (const [meetingUuid, attendees] of meetingsByUuid) {
      const segments = segmentsByMeeting.get(meetingUuid) || [];

      for (const attendee of attendees) {
        // Match attendee to member using centralized logic
        const match = matchAttendeeToMember(attendee.name, attendee.email, members || [], aliases || []);

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

        // Filter out short edge segments when adjacent to a longer segment
        // (prevents double-counting someone who showed up early/late by <15 min)
        const filteredIntersections = intersections.filter((item, index) => {
          // Only filter short segments (<15 min)
          if (item.durationMin >= 15) return true;

          // Check if there's an adjacent longer segment
          const prevIntersection = index > 0 ? intersections[index - 1] : null;
          const nextIntersection = index < intersections.length - 1 ? intersections[index + 1] : null;

          const hasAdjacentLonger =
            (prevIntersection && prevIntersection.durationMin >= 15) ||
            (nextIntersection && nextIntersection.durationMin >= 15);

          // If short segment adjacent to longer segment, filter it out
          // (e.g., joined 4 min early for next prickle, or stayed 3 min late from previous)
          if (hasAdjacentLonger) {
            return false;
          }

          // Keep short standalone segments (e.g., quick 10-min check-in with no adjacent attendance)
          return true;
        });

        // Collect attendance records for atomic insert
        // For calendar segments: prickle_id is a real UUID
        // For PUP segments: client_prickle_id is a temp ID (will be resolved by atomic function)
        for (const item of filteredIntersections) {
          const prickleIdOrClientId = prickleIdsBySegment.get(item.segment);
          if (!prickleIdOrClientId) {
            segmentLookupFailures++;
            console.error(`Failed to find prickle ID for segment:`, {
              segmentType: item.segment.type,
              segmentStart: item.segment.start_time,
              segmentEnd: item.segment.end_time,
              mapSize: prickleIdsBySegment.size,
            });
            continue;
          }

          // Determine if this is a calendar prickle (UUID) or PUP (temp ID)
          const isCalendarPrickle = item.segment.type === "calendar";
          const attendanceRecord: any = {
            member_id: match.member_id,
            join_time: item.intersection.start.toISOString(),
            leave_time: item.intersection.end.toISOString(),
            confidence_score: match.confidence,
          };

          if (isCalendarPrickle) {
            attendanceRecord.prickle_id = prickleIdOrClientId; // Real UUID
            attendanceRecord.client_prickle_id = null;
          } else {
            attendanceRecord.prickle_id = null;
            attendanceRecord.client_prickle_id = prickleIdOrClientId; // Temp ID
          }

          attendanceToUpsert.push(attendanceRecord);
        }
      }
    }

    console.log(`Segment lookup failures: ${segmentLookupFailures}`);
    console.log(`Collected ${attendanceToUpsert.length} attendance records and ${pupsToCreate.length} PUPs to insert atomically`);

    // STEP 5: Atomically reprocess attendance and PUPs using database function
    // This ensures DELETE + INSERT happens in a single transaction,
    // preventing users from seeing partial state during reprocessing
    const { error: reprocessError } = await supabase.rpc('reprocess_prickle_attendance_atomic', {
      from_date: fromDateTime,
      to_date: toDateTime,
      new_pup_data: pupsToCreate,
      new_attendance_data: attendanceToUpsert,
    });

    if (reprocessError) {
      console.error("Error atomically reprocessing attendance:", reprocessError);
      throw reprocessError;
    }

    attendanceRecords = attendanceToUpsert.length;
    console.log(`Successfully reprocessed ${attendanceRecords} attendance records and ${pupsToCreate.length} PUPs`);

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
