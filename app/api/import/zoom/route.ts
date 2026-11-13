import { requireAdmin } from "@/lib/supabase/api-auth";
import { createZoomClientForPrefix, type ZoomClient } from "@/lib/zoom/client";
import { triggerReprocessing } from "@/lib/processing/trigger";
import { NextRequest, NextResponse } from "next/server";
import { asJson } from "@/lib/data/json";
import { createRepos } from "@/lib/data/repos";
import type { ZoomAccount, ZoomRepository } from "@/lib/data/zoom";
import { importReprocessRange } from "@/lib/processing/attendance";
import { PRIMARY_ZOOM_ACCOUNT_SLUG, zoomCredentialNames } from "@/lib/zoom-accounts";

interface AccountSummary {
  account: string;
  meetings: number;
  attendees: number;
  /** Set when the account was not imported: its credentials are not configured, or the import failed. */
  skipped?: string;
}

/**
 * Imports one account's meetings and participants into Bronze, tagged with the account.
 * Bronze keeps everything the account hosted; which meetings reach Silver is decided at processing time.
 */
async function importAccount(
  zoomRepo: ZoomRepository,
  account: ZoomAccount,
  zoom: ZoomClient,
  fromDate: string,
  toDate: string
) {
  const meetings = await zoom.listMeetings(fromDate, toDate);
  let totalAttendees = 0;
  const processed = [];

  for (const meeting of meetings) {
    const meetingToInsert = {
      zoom_account: account.id,
      meeting_uuid: meeting.uuid,
      meeting_id: meeting.id.toString(),
      topic: meeting.topic,
      start_time: meeting.start_time,
      end_time: meeting.end_time || null,
      duration_minutes: meeting.duration || null,
      host_email: meeting.host_email || null,
      host_name: meeting.host_name || null,
      participant_count: meeting.participants_count || null,
      data: asJson(meeting),
    };

    try {
      await zoomRepo.upsertMeeting(meetingToInsert); // updates the meeting if it exists
    } catch (meetingError) {
      console.error(`Error upserting meeting ${meeting.uuid}:`, meetingError);
      throw meetingError;
    }

    const participants = await zoom.getParticipants(meeting.uuid);

    const attendeesToInsert = participants.map((p) => ({
      zoom_account: account.id,
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
      raw_payload: asJson(p),
    }));

    if (attendeesToInsert.length > 0) {
      try {
        await zoomRepo.upsertAttendees(attendeesToInsert); // updates a row that already exists, in chunks
      } catch (error) {
        console.error(`Error upserting attendees for meeting ${meeting.uuid}:`, error);
        throw error;
      }
      totalAttendees += attendeesToInsert.length;
    }

    processed.push({
      uuid: meeting.uuid,
      topic: meeting.topic,
      start_time: meeting.start_time,
      participants: participants.length,
      account: account.slug,
    });
  }

  return { meetings: meetings.length, attendees: totalAttendees, processed };
}

export async function POST(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (!auth.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (auth.forbidden) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { supabase } = auth;
  const zoomRepo = createRepos(supabase).zoom;

  try {
    const parsed = await request.json().catch(() => undefined);
    if (parsed === undefined) return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    const body = parsed;
    const { fromDate, toDate, skipProcessing = false, account: onlyAccount } = body;

    if (!fromDate || !toDate) {
      return NextResponse.json(
        { error: "fromDate and toDate are required" },
        { status: 400 }
      );
    }

    // Every account is imported (nightly reconcile and manual imports cover them all); a webhook names the one it came from.
    const accounts = (await zoomRepo.accounts())
      .filter((a) => !onlyAccount || a.slug === onlyAccount)
      // The primary account first: its failure fails the import, a secondary account's never does.
      .sort((a, b) => Number(b.slug === PRIMARY_ZOOM_ACCOUNT_SLUG) - Number(a.slug === PRIMARY_ZOOM_ACCOUNT_SLUG));

    let totalAttendees = 0;
    let totalMeetings = 0;
    const processedMeetings = [];
    const summaries: AccountSummary[] = [];

    for (const account of accounts) {
      const isPrimary = account.slug === PRIMARY_ZOOM_ACCOUNT_SLUG;
      const zoom = createZoomClientForPrefix(account.credentialsPrefix);
      if (!zoom) {
        const names = zoomCredentialNames(account.credentialsPrefix);
        const message = `credentials not configured (${names.accountId}, ${names.clientId}, ${names.clientSecret}, ${names.userEmail})`;
        if (isPrimary) {
          throw new Error(`Missing Zoom credentials. Please set ${names.accountId}, ${names.clientId}, ${names.clientSecret}, and ${names.userEmail} in .env.local`);
        }
        console.warn(`Skipping Zoom account ${account.slug}: ${message}`);
        summaries.push({ account: account.slug, meetings: 0, attendees: 0, skipped: message });
        continue;
      }

      try {
        const result = await importAccount(zoomRepo, account, zoom, fromDate, toDate);
        totalMeetings += result.meetings;
        totalAttendees += result.attendees;
        processedMeetings.push(...result.processed);
        summaries.push({ account: account.slug, meetings: result.meetings, attendees: result.attendees });
      } catch (error: any) {
        if (isPrimary) throw error;
        // A secondary account must never fail the primary one's import.
        console.error(`Error importing Zoom account ${account.slug}:`, error);
        summaries.push({ account: account.slug, meetings: 0, attendees: 0, skipped: `import failed: ${error?.message ?? "unknown error"}` });
      }
    }

    if (skipProcessing) {
      return NextResponse.json({
        success: true,
        meetings: totalMeetings,
        totalAttendees,
        data: processedMeetings,
        accounts: summaries,
        reprocessing: "skipped",
      });
    }

    // Trigger downstream Silver layer processing
    // fromDate and toDate are days when they carry no time: the end day is covered whole.
    const { from, to } = importReprocessRange(fromDate, toDate);

    console.log(`Triggering reprocessing for zoom_attendees and zoom_meetings (${fromDate} to ${toDate}: ${from.toISOString()} to ${to.toISOString()})`);

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
      accounts: summaries,
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
