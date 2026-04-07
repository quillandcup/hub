import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import ProcessOrphanedButton from "./ProcessOrphanedButton";
import ProcessOrphanedMeetingsButton from "./ProcessOrphanedMeetingsButton";

export const dynamic = "force-dynamic";

export default async function DataHygienePage() {
  const supabase = await createClient();

  // Fetch data quality metrics
  const [
    { count: totalCalendarEvents },
    { count: matchedCalendarEvents },
    { count: unmatchedCalendarEvents },
    { count: totalZoomAttendees },
    { count: totalMembers },
    { count: totalAliases },
    { data: pupsWith0Attendees },
    { data: oldUnmatchedEvents },
    { data: lastSync },
    { data: lastProcessing },
  ] = await Promise.all([
    supabase.from("calendar_events").select("*", { count: "exact", head: true }),
    supabase.from("prickles").select("*", { count: "exact", head: true }).eq("source", "calendar"),
    supabase.from("unmatched_calendar_events").select("*", { count: "exact", head: true }).eq("status", "pending"),
    supabase.from("zoom_attendees").select("*", { count: "exact", head: true }),
    supabase.from("members").select("*", { count: "exact", head: true }),
    supabase.from("member_name_aliases").select("*", { count: "exact", head: true }),
    // Find PUPs with 0 attendees
    supabase
      .from("prickles")
      .select("id, start_time, end_time")
      .eq("source", "zoom")
      .not("id", "in", `(SELECT DISTINCT prickle_id FROM attendance WHERE prickle_id IS NOT NULL)`)
      .limit(10),
    // Find old unmatched events (queued before prickle_types migration)
    supabase
      .from("unmatched_calendar_events")
      .select("id, raw_summary, created_at")
      .eq("status", "pending")
      .lt("created_at", "2026-04-06 02:00:00") // Before prickle_types were added
      .limit(10),
    // Last calendar sync (use imported_at which updates on UPSERT)
    supabase
      .from("calendar_events")
      .select("imported_at")
      .order("imported_at", { ascending: false })
      .limit(1)
      .single(),
    // Last attendance processing (most recent PUP)
    supabase
      .from("prickles")
      .select("created_at")
      .eq("source", "zoom")
      .order("created_at", { ascending: false })
      .limit(1)
      .single(),
  ]);

  const calendarMatchRate = totalCalendarEvents && matchedCalendarEvents
    ? Math.round((matchedCalendarEvents / totalCalendarEvents) * 100)
    : 0;

  // Calculate orphaned events (imported but never processed)
  const orphanedEvents = (totalCalendarEvents || 0) - (matchedCalendarEvents || 0) - (unmatchedCalendarEvents || 0);

  // Calculate zoom match rate by counting zoom_attendees in processed meetings
  // Processed meetings = those with PUPs or calendar overlap (calculated below)
  const processedMeetingUuidsSet = new Set<string>();

  // Will be populated by orphaned meetings calculation below
  // (meeting is processed if it's NOT orphaned)

  // Get date range of orphaned events if any exist
  // We use the full calendar_events range as an approximation
  // The processing uses DELETE + INSERT so it's safe to reprocess the full range
  let orphanedDateRange = null;
  if (orphanedEvents > 0) {
    const [{ data: minEvent }, { data: maxEvent }] = await Promise.all([
      supabase
        .from("calendar_events")
        .select("start_time")
        .order("start_time", { ascending: true })
        .limit(1)
        .single(),
      supabase
        .from("calendar_events")
        .select("end_time")
        .order("end_time", { ascending: false })
        .limit(1)
        .single(),
    ]);

    if (minEvent && maxEvent) {
      orphanedDateRange = { fromDate: minEvent.start_time, toDate: maxEvent.end_time };
    }
  }

  // Calculate orphaned Zoom meetings (meetings where attendees weren't processed)
  // Note: Meetings can be processed in two ways:
  // 1. Create new PUPs (prickles with source='zoom' and zoom_meeting_uuid)
  // 2. Match to existing calendar prickles (no new prickle, but attendance created)

  // Get all unique meeting UUIDs and their time windows
  const { data: meetingWindows } = await supabase
    .from("zoom_attendees")
    .select("meeting_uuid, join_time, leave_time")
    .not("meeting_uuid", "is", null);

  // Group by meeting_uuid to get time windows
  const meetingTimeWindows = new Map<string, { start: Date; end: Date }>();
  meetingWindows?.forEach(m => {
    const existing = meetingTimeWindows.get(m.meeting_uuid);
    const joinTime = new Date(m.join_time);
    const leaveTime = new Date(m.leave_time);

    if (existing) {
      existing.start = new Date(Math.min(existing.start.getTime(), joinTime.getTime()));
      existing.end = new Date(Math.max(existing.end.getTime(), leaveTime.getTime()));
    } else {
      meetingTimeWindows.set(m.meeting_uuid, { start: joinTime, end: leaveTime });
    }
  });

  // Get all prickles (calendar and zoom) with their time windows
  const { data: allPricklesForOverlap } = await supabase
    .from("prickles")
    .select("id, start_time, end_time, zoom_meeting_uuid, source");

  // Check each meeting to see if it has been processed
  const orphanedMeetingUuids: string[] = [];

  for (const [meetingUuid, timeWindow] of meetingTimeWindows) {
    // Check if this meeting has a PUP
    const hasPUP = allPricklesForOverlap?.some(
      p => p.source === 'zoom' && p.zoom_meeting_uuid === meetingUuid
    );

    if (hasPUP) {
      processedMeetingUuidsSet.add(meetingUuid);
      continue; // Not orphaned - has a PUP
    }

    // Check if meeting overlaps with any calendar prickle
    const overlapsCalendar = allPricklesForOverlap?.some(p => {
      if (p.source !== 'calendar') return false;
      const prickleStart = new Date(p.start_time);
      const prickleEnd = new Date(p.end_time);
      // Check for time overlap
      return prickleStart < timeWindow.end && prickleEnd > timeWindow.start;
    });

    if (overlapsCalendar) {
      processedMeetingUuidsSet.add(meetingUuid);
    } else {
      // No PUP and no calendar overlap = truly orphaned
      orphanedMeetingUuids.push(meetingUuid);
    }
  }

  const orphanedMeetings = orphanedMeetingUuids.length;

  // Count zoom_attendees in processed meetings
  const { data: allZoomAttendeesForCount } = await supabase
    .from("zoom_attendees")
    .select("meeting_uuid")
    .not("meeting_uuid", "is", null);

  const matchedZoomAttendees = allZoomAttendeesForCount?.filter(
    za => processedMeetingUuidsSet.has(za.meeting_uuid)
  ).length || 0;

  const unmatchedZoomAttendees = (totalZoomAttendees || 0) - matchedZoomAttendees;

  // Get date range of orphaned meetings if any exist
  let orphanedMeetingsDateRange = null;
  if (orphanedMeetings > 0) {
    const [{ data: minMeeting }, { data: maxMeeting }] = await Promise.all([
      supabase
        .from("zoom_attendees")
        .select("join_time")
        .not("meeting_uuid", "is", null)
        .order("join_time", { ascending: true })
        .limit(1)
        .single(),
      supabase
        .from("zoom_attendees")
        .select("leave_time")
        .not("meeting_uuid", "is", null)
        .order("leave_time", { ascending: false })
        .limit(1)
        .single(),
    ]);

    if (minMeeting && maxMeeting) {
      orphanedMeetingsDateRange = { fromDate: minMeeting.join_time, toDate: maxMeeting.leave_time };
    }
  }

  return (
    <div className="p-6">
      <div className="max-w-7xl mx-auto">
        <h1 className="text-3xl font-bold text-slate-900 dark:text-slate-100 mb-8">
          Data Hygiene Dashboard
        </h1>

        {/* At-a-glance metrics */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-8">
          {/* Calendar Events */}
          <Link
            href="/hygiene/unmatched-events"
            className="block p-6 bg-white dark:bg-slate-900 rounded-lg shadow hover:shadow-lg transition-shadow border border-slate-200 dark:border-slate-800"
          >
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-medium text-slate-600 dark:text-slate-400">
                Calendar Events
              </h3>
              <span className="text-2xl">📋</span>
            </div>
            <p className="text-3xl font-bold text-slate-900 dark:text-slate-100 mb-1">
              {calendarMatchRate}%
            </p>
            <p className="text-sm text-slate-600 dark:text-slate-400">
              {matchedCalendarEvents}/{totalCalendarEvents} matched
            </p>
            {unmatchedCalendarEvents && unmatchedCalendarEvents > 0 && (
              <p className="text-xs text-orange-600 dark:text-orange-400 mt-2">
                {unmatchedCalendarEvents} unmatched events →
              </p>
            )}
          </Link>

          {/* Zoom Attendees */}
          <Link
            href="/hygiene/unmatched-zoom"
            className="block p-6 bg-white dark:bg-slate-900 rounded-lg shadow hover:shadow-lg transition-shadow border border-slate-200 dark:border-slate-800"
          >
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-medium text-slate-600 dark:text-slate-400">
                Zoom Attendees
              </h3>
              <span className="text-2xl">🔍</span>
            </div>
            <p className="text-3xl font-bold text-slate-900 dark:text-slate-100 mb-1">
              {totalZoomAttendees && matchedZoomAttendees
                ? Math.round((matchedZoomAttendees / totalZoomAttendees) * 100)
                : 0}%
            </p>
            <p className="text-sm text-slate-600 dark:text-slate-400">
              {matchedZoomAttendees}/{totalZoomAttendees} matched
            </p>
            {unmatchedZoomAttendees > 0 && (
              <p className="text-xs text-orange-600 dark:text-orange-400 mt-2">
                View unmatched names →
              </p>
            )}
          </Link>

          {/* Name Aliases */}
          <Link
            href="/data/aliases"
            className="block p-6 bg-white dark:bg-slate-900 rounded-lg shadow hover:shadow-lg transition-shadow border border-slate-200 dark:border-slate-800"
          >
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-medium text-slate-600 dark:text-slate-400">
                Name Aliases
              </h3>
              <span className="text-2xl">🧩</span>
            </div>
            <p className="text-3xl font-bold text-slate-900 dark:text-slate-100 mb-1">
              {totalAliases}
            </p>
            <p className="text-sm text-slate-600 dark:text-slate-400">
              active aliases for {totalMembers} members
            </p>
            <p className="text-xs text-blue-600 dark:text-blue-400 mt-2">
              View all aliases →
            </p>
          </Link>
        </div>

        {/* Data quality warnings */}
        <div className="space-y-4 mb-8">
          {orphanedEvents > 0 && (
            <div className="p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
              <div className="flex items-start gap-3">
                <span className="text-xl">🚨</span>
                <div className="flex-1">
                  <h3 className="font-semibold text-red-900 dark:text-red-100 mb-1">
                    {orphanedEvents} orphaned calendar events detected
                  </h3>
                  <p className="text-sm text-red-800 dark:text-red-200 mb-2">
                    These events were imported but never processed - they're not in prickles or the
                    unmatched queue. This usually means they fell outside the date range during processing.
                  </p>
                  <div className="mt-3">
                    <ProcessOrphanedButton
                      orphanedCount={orphanedEvents}
                      dateRange={orphanedDateRange}
                    />
                  </div>
                </div>
              </div>
            </div>
          )}

          {oldUnmatchedEvents && oldUnmatchedEvents.length > 0 && (
            <div className="p-4 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg">
              <div className="flex items-start gap-3">
                <span className="text-xl">💡</span>
                <div className="flex-1">
                  <h3 className="font-semibold text-blue-900 dark:text-blue-100 mb-1">
                    {oldUnmatchedEvents.length}+ old unmatched events can be auto-resolved
                  </h3>
                  <p className="text-sm text-blue-800 dark:text-blue-200 mb-2">
                    These events were queued before prickle types were added and can now be
                    automatically categorized (e.g., &quot;Heads Down Prickle&quot;).
                  </p>
                  <p className="text-xs text-blue-700 dark:text-blue-300">
                    Recommendation: Reprocess calendar events from early March to auto-resolve
                    these events.
                  </p>
                </div>
              </div>
            </div>
          )}

          {orphanedMeetings > 0 && (
            <div className="p-4 bg-orange-50 dark:bg-orange-900/20 border border-orange-200 dark:border-orange-800 rounded-lg">
              <div className="flex items-start gap-3">
                <span className="text-xl">🚨</span>
                <div className="flex-1">
                  <h3 className="font-semibold text-orange-900 dark:text-orange-100 mb-1">
                    {orphanedMeetings} orphaned Zoom meetings detected
                  </h3>
                  <p className="text-sm text-orange-800 dark:text-orange-200 mb-2">
                    These Zoom meetings have attendee records but were never processed into Pop-Up Prickles.
                    This usually means they fell outside the date range during attendance processing.
                  </p>
                  <div className="mt-3">
                    <ProcessOrphanedMeetingsButton
                      orphanedCount={orphanedMeetings}
                      dateRange={orphanedMeetingsDateRange}
                    />
                  </div>
                </div>
              </div>
            </div>
          )}

          {pupsWith0Attendees && pupsWith0Attendees.length > 0 && (
            <div className="p-4 bg-orange-50 dark:bg-orange-900/20 border border-orange-200 dark:border-orange-800 rounded-lg">
              <div className="flex items-start gap-3">
                <span className="text-xl">⚠️</span>
                <div className="flex-1">
                  <h3 className="font-semibold text-orange-900 dark:text-orange-100 mb-1">
                    {pupsWith0Attendees.length} PUPs with 0 attendees detected
                  </h3>
                  <p className="text-sm text-orange-800 dark:text-orange-200 mb-2">
                    These Pop-Up Prickles were created but have no attendance records.
                    This usually indicates unmatched Zoom attendees or data quality issues.
                  </p>
                  <p className="text-xs text-orange-700 dark:text-orange-300">
                    Recommendation: Review unmatched Zoom attendees and reprocess attendance data.
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Recent activity */}
        <div className="bg-white dark:bg-slate-900 rounded-lg shadow border border-slate-200 dark:border-slate-800 p-6">
          <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100 mb-4">
            Recent Activity
          </h2>
          <div className="space-y-3 text-sm">
            <div className="flex justify-between items-center">
              <span className="text-slate-600 dark:text-slate-400">Last calendar sync:</span>
              <span className="font-medium text-slate-900 dark:text-slate-100">
                {lastSync?.imported_at
                  ? new Date(lastSync.imported_at).toLocaleString()
                  : "Never"}
              </span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-slate-600 dark:text-slate-400">Last attendance processing:</span>
              <span className="font-medium text-slate-900 dark:text-slate-100">
                {lastProcessing?.created_at
                  ? new Date(lastProcessing.created_at).toLocaleString()
                  : "Never"}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
