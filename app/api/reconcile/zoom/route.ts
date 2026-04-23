import { createClient } from "@/lib/supabase/server";
import { createZoomClient } from "@/lib/zoom/client";
import { triggerReprocessing } from "@/lib/processing/trigger";
import { NextRequest, NextResponse } from "next/server";

// Extend timeout for reconciliation jobs
export const maxDuration = 300; // 5 minutes (max for Hobby tier)

/**
 * Daily reconciliation job for Zoom attendance data
 * Fetches ALL Zoom data (last 90 days) and reprocesses Silver layer
 * This catches any webhooks that failed or were missed
 *
 * Scheduled to run daily at 2:30am via Vercel Cron
 */
export async function POST(request: NextRequest) {
  const supabase = await createClient();

  // Check authentication
  // For cron jobs, Vercel sends Authorization: Bearer <CRON_SECRET>
  // For manual testing, allow authenticated users
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Allow either cron secret or authenticated user
  const isAuthorizedCron = cronSecret && authHeader === `Bearer ${cronSecret}`;
  const isAuthenticatedUser = !!user;

  if (!isAuthorizedCron && !isAuthenticatedUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    // Initialize Zoom client (uses credentials from env)
    const zoom = createZoomClient();

    // Fetch last 90 days (safety margin for reconciliation)
    const now = new Date();
    const fromDate = new Date(now);
    fromDate.setDate(fromDate.getDate() - 90);
    const toDate = new Date(now);

    // Format dates for Zoom API (YYYY-MM-DD)
    const fromDateStr = fromDate.toISOString().split('T')[0];
    const toDateStr = toDate.toISOString().split('T')[0];

    console.log(`[Reconciliation] Fetching Zoom meetings from ${fromDateStr} to ${toDateStr}`);

    // 1. Fetch ALL meetings from Zoom API
    const meetings = await zoom.listMeetings(fromDateStr, toDateStr);

    console.log(`[Reconciliation] Found ${meetings.length} Zoom meetings`);

    if (!meetings || meetings.length === 0) {
      return NextResponse.json({
        success: true,
        message: "No Zoom meetings found in date range",
        meetings: 0,
        attendees: 0,
      });
    }

    let totalAttendees = 0;
    let totalMeetings = 0;
    const processedMeetings = [];

    // 2. UPSERT to Bronze layer (idempotent)
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
        .schema('bronze')
        .from("zoom_meetings")
        .upsert(meetingToInsert, {
          onConflict: "meeting_uuid",
          ignoreDuplicates: false, // Update if exists
        });

      if (meetingError) {
        console.error(`[Reconciliation] Error upserting meeting ${meeting.uuid}:`, meetingError);
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
          .schema('bronze')
          .from("zoom_attendees")
          .upsert(attendeesToInsert, {
            onConflict: "meeting_uuid,name,join_time",
            ignoreDuplicates: false, // Update if exists
          });

        if (error) {
          console.error(`[Reconciliation] Error upserting attendees for meeting ${meeting.uuid}:`, error);
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

    console.log(`[Reconciliation] Bronze layer updated: ${totalMeetings} meetings, ${totalAttendees} attendees`);

    // 3. Trigger Silver layer processing
    console.log(`[Reconciliation] Triggering attendance processing for ${fromDateStr} to ${toDateStr}`);

    // Trigger for both bronze tables that changed
    const attendeesResult = await triggerReprocessing('zoom_attendees', 'bronze', {
      dateRange: { from: fromDate, to: toDate }
    });

    const meetingsResult = await triggerReprocessing('zoom_meetings', 'bronze', {
      dateRange: { from: fromDate, to: toDate }
    });

    console.log(`[Reconciliation] Zoom reconciliation complete`);

    return NextResponse.json({
      success: true,
      reconciliation: "zoom",
      meetings: totalMeetings,
      attendees: totalAttendees,
      dateRange: {
        from: fromDateStr,
        to: toDateStr,
      },
      processing: {
        zoom_attendees: attendeesResult,
        zoom_meetings: meetingsResult,
      },
    });
  } catch (error: any) {
    console.error("[Reconciliation] Error in Zoom reconciliation:", error);
    return NextResponse.json(
      { error: error.message || "Failed to reconcile Zoom data" },
      { status: 500 }
    );
  }
}
