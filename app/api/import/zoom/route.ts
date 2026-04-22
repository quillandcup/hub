import { createClient } from "@/lib/supabase/server";
import { createZoomClient } from "@/lib/zoom/client";
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
    const processedMeetings = [];

    // For each meeting, fetch participants and insert into zoom_attendees
    for (const meeting of meetings) {
      const participants = await zoom.getParticipants(meeting.uuid);

      // Insert participants into zoom_attendees table (bronze - raw data only)
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
          .from("bronze.zoom_attendees")
          .upsert(attendeesToInsert, {
            onConflict: "meeting_uuid,name,join_time",
            ignoreDuplicates: true,
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

    return NextResponse.json({
      success: true,
      meetings: processedMeetings.length,
      totalAttendees,
      data: processedMeetings,
    });
  } catch (error: any) {
    console.error("Error importing Zoom data:", error);
    return NextResponse.json(
      { error: error.message || "Failed to import Zoom data" },
      { status: 500 }
    );
  }
}
