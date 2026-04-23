import { createClient } from "@/lib/supabase/server";
import { createZoomClient } from "@/lib/zoom/client";
import { triggerReprocessing } from "@/lib/processing/trigger";
import { NextRequest, NextResponse } from "next/server";

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

    const zoom = createZoomClient();

    // Fetch meetings from Zoom
    const meetings = await zoom.listMeetings(fromDate, toDate);

    let totalAttendees = 0;
    let totalMeetings = 0;
    const processedMeetings = [];

    // For each meeting, insert metadata and participants
    for (const meeting of meetings) {
      // Insert meeting metadata into zoom_meetings table (bronze)
      const meetingToInsert = {
        meeting_uuid: meeting.uuid,
        meeting_id: meeting.id.toString(),
        topic: meeting.topic,
        start_time: meeting.start_time,
        end_time: meeting.end_time || null,
        duration_minutes: meeting.duration || null,
        host_email: meeting.host_email || null,
        host_name: meeting.host_name || null,
        participant_count: meeting.participants_count || null,
        data: meeting,
      };

      const { error: meetingError } = await supabase
        .schema('bronze').from("zoom_meetings")
        .upsert(meetingToInsert, {
          onConflict: "meeting_uuid",
          ignoreDuplicates: false, // Update if exists
        });

      if (meetingError) {
        console.error(`Error upserting meeting ${meeting.uuid}:`, meetingError);
        throw meetingError;
      }

      totalMeetings++;

      // Fetch and insert participants
      const participants = await zoom.getParticipants(meeting.uuid);

      const attendeesToInsert = participants.map((p) => ({
        meeting_id: meeting.id.toString(),
        meeting_uuid: meeting.uuid,
        topic: meeting.topic,
        participant_id: p.id,
        user_id: p.user_id || null,
        registrant_id: p.registrant_id || null,
        name: p.name,
        email: p.user_email || null,
        join_time: p.join_time,
        leave_time: p.leave_time,
        duration: p.duration,
        attentiveness_score: p.attentiveness_score || null,
        failover: p.failover || false,
        status: p.status || null,
        raw_payload: p,
      }));

      if (attendeesToInsert.length > 0) {
        const { error } = await supabase
          .schema('bronze').from("zoom_attendees")
          .upsert(attendeesToInsert, {
            onConflict: "meeting_uuid,name,join_time",
            ignoreDuplicates: false, // Update if exists
          });

        if (error) {
          console.error(`Error upserting attendees for meeting ${meeting.uuid}:`, error);
          throw error;
        }

        totalAttendees += attendeesToInsert.length;
      }

      processedMeetings.push({
        uuid: meeting.uuid,
        topic: meeting.topic,
        start_time: meeting.start_time,
        participants: participants.length,
      });
    }

    // Trigger downstream Silver layer processing
    const from = new Date(fromDate);
    const to = new Date(toDate);

    console.log(`Triggering reprocessing for zoom_attendees and zoom_meetings (${fromDate} to ${toDate})`);

    // Trigger for both bronze tables that changed
    const attendeesResult = await triggerReprocessing('zoom_attendees', 'bronze', {
      dateRange: { from, to }
    });

    const meetingsResult = await triggerReprocessing('zoom_meetings', 'bronze', {
      dateRange: { from, to }
    });

    return NextResponse.json({
      success: true,
      meetings: totalMeetings,
      totalAttendees,
      data: processedMeetings,
      reprocessing: {
        zoom_attendees: attendeesResult,
        zoom_meetings: meetingsResult
      }
    });
  } catch (error: any) {
    console.error("Error importing Zoom data:", error);
    return NextResponse.json(
      { error: error.message || "Failed to import Zoom data" },
      { status: 500 }
    );
  }
}
