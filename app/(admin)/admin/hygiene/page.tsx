import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import ProcessOrphanedButton from "./ProcessOrphanedButton";
import ProcessOrphanedMeetingsButton from "./ProcessOrphanedMeetingsButton";
import { matchAttendeeToMember } from "@/lib/member-matching";
import { matchSlackUsersToMembers } from "@/lib/slack-matching";
import { detectDuplicates } from "@/lib/member-duplicates";
import { findStalePrivateChannels } from "@/lib/private-channel-access";

export const metadata: Metadata = {
  title: "Data Hygiene Dashboard",
};

export const dynamic = "force-dynamic";

export default async function DataHygienePage() {
  const supabase = await createClient();

  // Fetch data quality metrics
  const [
    { count: totalCalendarEvents },
    { count: matchedCalendarEvents },
    { count: unmatchedCalendarEvents },
    { count: calendarPricklesWithHost },
    { count: calendarPricklesMissingHost },
    { count: totalZoomAttendees },
    { count: totalMembers },
    { count: totalAliases },
    { data: slackUsersForMatching },
    { data: ignoredSlackUsers },
    { data: pupsWith0Attendees },
    { data: oldUnmatchedEvents },
    { data: lastSync },
    { data: lastProcessing },
    { data: lastSlackMessageSync },
    { data: lastSlackReactionSync },
    { data: lastSlackProcessing },
    { data: lastKajabiSync },
    { data: lastKajabiProcessing },
    { count: missingStripeCount },
    { data: membersForDuplicates },
    { data: slackChannelsForAccessCheck },
  ] = await Promise.all([
    supabase.schema('bronze').from("calendar_events").select("*", { count: "exact", head: true }),
    supabase.from("prickles").select("*", { count: "exact", head: true }).eq("source", "calendar"),
    supabase.from("unmatched_calendar_events").select("*", { count: "exact", head: true }).eq("status", "pending"),
    // Count prickles with hosts (only those that require hosts)
    supabase.from("prickles").select("*, prickle_types!inner(requires_host)", { count: "exact", head: true })
      .eq("source", "calendar")
      .not("host", "is", null)
      .eq("prickle_types.requires_host", true),
    // Count prickles missing hosts (only those that require hosts)
    supabase.from("prickles").select("*, prickle_types!inner(requires_host)", { count: "exact", head: true })
      .eq("source", "calendar")
      .is("host", null)
      .eq("prickle_types.requires_host", true),
    supabase.schema('bronze').from("zoom_attendees").select("*", { count: "exact", head: true }),
    supabase.from("members").select("*", { count: "exact", head: true }),
    supabase.from("member_name_aliases").select("*", { count: "exact", head: true }),
    // Slack users for unmatched-count (workspace member list stays well under 1000 rows)
    supabase.schema('bronze').from("slack_users").select("user_id, email, real_name, is_bot"),
    supabase.from("ignored_slack_users").select("user_id"),
    // Find PUPs with 0 attendees
    supabase
      .from("prickles")
      .select("id, start_time, end_time")
      .eq("source", "zoom")
      .not("id", "in", `(SELECT DISTINCT prickle_id FROM prickle_attendance WHERE prickle_id IS NOT NULL)`)
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
      .schema('bronze').from("calendar_events")
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
    // Last Slack sync (bronze import — webhook or bulk import, both set imported_at).
    // Checked across both tables since a sync can land only reactions or only
    // messages depending on what happened in Slack during that window.
    supabase
      .schema('bronze').from("slack_messages")
      .select("imported_at")
      .order("imported_at", { ascending: false })
      .limit(1)
      .single(),
    supabase
      .schema('bronze').from("slack_reactions")
      .select("imported_at")
      .order("imported_at", { ascending: false })
      .limit(1)
      .single(),
    // Last Slack processing (silver — member_activities uses DELETE+INSERT per date range,
    // so created_at reflects the most recent process/slack run)
    supabase
      .from("member_activities")
      .select("created_at")
      .eq("source", "slack")
      .order("created_at", { ascending: false })
      .limit(1)
      .single(),
    // Last Kajabi sync (bronze import via Kajabi API)
    supabase
      .schema('bronze').from("kajabi_contacts")
      .select("imported_at")
      .order("imported_at", { ascending: false })
      .limit(1)
      .single(),
    // Last Kajabi processing (silver — reprocess_members_atomic unconditionally touches
    // updated_at for every kajabi-sourced member on each run)
    supabase
      .from("members")
      .select("updated_at")
      .not("kajabi_id", "is", null)
      .order("updated_at", { ascending: false })
      .limit(1)
      .single(),
    // Active members missing Stripe customer ID
    supabase.from("members").select("*", { count: "exact", head: true })
      .eq("status", "active")
      .is("stripe_customer_id", null),
    // Members for duplicate detection (limit 1000; members table stays small)
    supabase.from("members").select("id, name, email, status").order("name"),
    // Slack channels BillieBot can currently see (workspace channel count stays well under 1000)
    supabase.schema('bronze').from("slack_channels").select("channel_id, name, is_private, imported_at"),
  ]);

  const duplicateCount = detectDuplicates(membersForDuplicates ?? []).length;
  const stalePrivateChannels = findStalePrivateChannels(slackChannelsForAccessCheck ?? []);

  const calendarMatchRate = totalCalendarEvents && matchedCalendarEvents
    ? Math.round((matchedCalendarEvents / totalCalendarEvents) * 100)
    : 0;

  // Host match rate: % of prickles requiring hosts that have hosts
  const totalRequiringHosts = (calendarPricklesWithHost || 0) + (calendarPricklesMissingHost || 0);
  const hostMatchRate = totalRequiringHosts > 0
    ? Math.round(((calendarPricklesWithHost || 0) / totalRequiringHosts) * 100)
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
        .schema('bronze').from("calendar_events")
        .select("start_time")
        .order("start_time", { ascending: true })
        .limit(1)
        .single(),
      supabase
        .schema('bronze').from("calendar_events")
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

  // CRITICAL: Must use same matching logic as processing to calculate meeting windows
  // Otherwise orphaned count will include unmatched attendee time ranges that never get processed

  // Load members and aliases for matching (same as processing does)
  const [{ data: membersForMatching }, { data: aliasesForMatching }] = await Promise.all([
    supabase.from("members").select("id, name, email"),
    supabase.from("member_name_aliases").select("alias, member_id, source"),
  ]);

  // Unmatched Slack users (not matched, not ignored, not bots) — mirrors
  // /api/reports/unmatched-slack-users and the unmatched-slack hygiene page
  const slackMatchedUserIds = await matchSlackUsersToMembers(
    slackUsersForMatching || [],
    membersForMatching || [],
    aliasesForMatching || []
  );
  const ignoredSlackUserIds = new Set((ignoredSlackUsers || []).map(u => u.user_id));
  const unmatchedSlackUsersCount = (slackUsersForMatching || []).filter(
    u => !slackMatchedUserIds.has(u.user_id) && !ignoredSlackUserIds.has(u.user_id) && !u.is_bot
  ).length;

  // Reverse direction: active members with no matched Slack user at all —
  // catches members who never joined Slack (no slack_users row to be
  // "unmatched" in the first place), which the check above can't see.
  const slackMatchedMemberIds = new Set(slackMatchedUserIds.values());
  const membersWithoutSlackCount = (membersForDuplicates || []).filter(
    m => m.status === "active" && !slackMatchedMemberIds.has(m.id)
  ).length;

  // Get all zoom_attendees with name/email for matching (paginated — table exceeds 1000 rows)
  const allAttendeesForMatching: { meeting_uuid: string; name: string; email: string | null; join_time: string; leave_time: string }[] = [];
  {
    const BATCH = 1000;
    let offset = 0, hasMore = true;
    while (hasMore) {
      const { data: batch } = await supabase
        .schema('bronze').from("zoom_attendees")
        .select("meeting_uuid, name, email, join_time, leave_time")
        .not("meeting_uuid", "is", null)
        .range(offset, offset + BATCH - 1);
      if (batch && batch.length > 0) {
        allAttendeesForMatching.push(...batch);
        offset += batch.length;
        hasMore = batch.length === BATCH;
      } else {
        hasMore = false;
      }
    }
  }

  // Group by meeting_uuid, but ONLY use MATCHED attendees to calculate time windows
  // This matches what the processing does (see route.ts line 358)
  const meetingTimeWindows = new Map<string, { start: Date; end: Date }>();
  allAttendeesForMatching?.forEach(m => {
    // Skip unmatched attendees (use centralized matching logic)
    if (!matchAttendeeToMember(m.name, m.email, membersForMatching || [], aliasesForMatching || [])) return;

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

  // Get all prickles (calendar and zoom) with their time windows (paginated — table exceeds 1000 rows)
  const allPricklesForOverlap: { id: string; start_time: string; end_time: string; zoom_meeting_uuid: string | null; source: string }[] = [];
  {
    const BATCH = 1000;
    let offset = 0, hasMore = true;
    while (hasMore) {
      const { data: batch } = await supabase
        .from("prickles")
        .select("id, start_time, end_time, zoom_meeting_uuid, source")
        .order("start_time")
        .range(offset, offset + BATCH - 1);
      if (batch && batch.length > 0) {
        allPricklesForOverlap.push(...batch);
        offset += batch.length;
        hasMore = batch.length === BATCH;
      } else {
        hasMore = false;
      }
    }
  }

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

  // Count zoom_attendees in processed meetings — reuse allAttendeesForMatching (already paginated)
  const matchedZoomAttendees = allAttendeesForMatching.filter(
    za => processedMeetingUuidsSet.has(za.meeting_uuid)
  ).length;

  const unmatchedZoomAttendees = (totalZoomAttendees || 0) - matchedZoomAttendees;

  // Get date range of orphaned meetings if any exist
  // Use the time windows we already calculated (from matched attendees)
  let orphanedMeetingsDateRange = null;
  if (orphanedMeetings > 0) {
    const orphanedWindows = orphanedMeetingUuids
      .map(uuid => meetingTimeWindows.get(uuid))
      .filter((w): w is { start: Date; end: Date } => w !== undefined);

    if (orphanedWindows.length > 0) {
      const minStart = new Date(Math.min(...orphanedWindows.map(w => w.start.getTime())));
      const maxEnd = new Date(Math.max(...orphanedWindows.map(w => w.end.getTime())));
      orphanedMeetingsDateRange = {
        fromDate: minStart.toISOString(),
        toDate: maxEnd.toISOString()
      };
    }
  }

  const lastSlackSyncAt = [lastSlackMessageSync?.imported_at, lastSlackReactionSync?.imported_at]
    .filter((d): d is string => !!d)
    .sort()
    .pop();

  return (
    <div className="p-6">
      <div className="max-w-7xl mx-auto">
        <h1 className="text-3xl font-bold text-slate-900 dark:text-slate-100 mb-8">
          Data Hygiene Dashboard
        </h1>

        {/* At-a-glance metrics */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
          {/* Calendar Events */}
          <Link
            href="/admin/hygiene/unmatched-events"
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

          {/* Host Assignment */}
          <Link
            href="/admin/data-health/missing-hosts"
            className="block p-6 bg-white dark:bg-slate-900 rounded-lg shadow hover:shadow-lg transition-shadow border border-slate-200 dark:border-slate-800"
          >
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-medium text-slate-600 dark:text-slate-400">
                Host Assignment
              </h3>
              <span className="text-2xl">👤</span>
            </div>
            <p className="text-3xl font-bold text-slate-900 dark:text-slate-100 mb-1">
              {hostMatchRate}%
            </p>
            <p className="text-sm text-slate-600 dark:text-slate-400">
              {calendarPricklesWithHost}/{totalRequiringHosts} assigned
            </p>
            {calendarPricklesMissingHost && calendarPricklesMissingHost > 0 && (
              <p className="text-xs text-orange-600 dark:text-orange-400 mt-2">
                {calendarPricklesMissingHost} missing hosts →
              </p>
            )}
          </Link>

          {/* Zoom Attendees */}
          <Link
            href="/admin/hygiene/unmatched-zoom"
            className="block p-6 bg-white dark:bg-slate-900 rounded-lg shadow hover:shadow-lg transition-shadow border border-slate-200 dark:border-slate-800"
          >
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-medium text-slate-600 dark:text-slate-400">
                Zoom Coverage
              </h3>
              <span className="text-2xl">🔍</span>
            </div>
            <p className="text-3xl font-bold text-slate-900 dark:text-slate-100 mb-1">
              {totalZoomAttendees && matchedZoomAttendees
                ? Math.round((matchedZoomAttendees / totalZoomAttendees) * 100)
                : 0}%
            </p>
            <p className="text-sm text-slate-600 dark:text-slate-400">
              {matchedZoomAttendees}/{totalZoomAttendees} in processed meetings
            </p>
            {unmatchedZoomAttendees > 0 && (
              <p className="text-xs text-orange-600 dark:text-orange-400 mt-2">
                View unmatched names →
              </p>
            )}
          </Link>

          {/* Slack Users */}
          <Link
            href="/admin/hygiene/unmatched-slack"
            className="block p-6 bg-white dark:bg-slate-900 rounded-lg shadow hover:shadow-lg transition-shadow border border-slate-200 dark:border-slate-800"
          >
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-medium text-slate-600 dark:text-slate-400">
                Slack Users
              </h3>
              <span className="text-2xl">💬</span>
            </div>
            <p className="text-3xl font-bold text-slate-900 dark:text-slate-100 mb-1">
              {unmatchedSlackUsersCount}
            </p>
            <p className="text-sm text-slate-600 dark:text-slate-400">
              unmatched Slack user{unmatchedSlackUsersCount !== 1 ? "s" : ""}
            </p>
            {unmatchedSlackUsersCount > 0 && (
              <p className="text-xs text-orange-600 dark:text-orange-400 mt-2">
                View unmatched users →
              </p>
            )}
            {unmatchedSlackUsersCount === 0 && (
              <p className="text-xs text-green-600 dark:text-green-400 mt-2">
                All matched ✓
              </p>
            )}
          </Link>

          {/* Members Without Slack (reverse direction) */}
          <Link
            href="/admin/hygiene/members-without-slack"
            className="block p-6 bg-white dark:bg-slate-900 rounded-lg shadow hover:shadow-lg transition-shadow border border-slate-200 dark:border-slate-800"
          >
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-medium text-slate-600 dark:text-slate-400">
                Members Without Slack
              </h3>
              <span className="text-2xl">🔁</span>
            </div>
            <p className="text-3xl font-bold text-slate-900 dark:text-slate-100 mb-1">
              {membersWithoutSlackCount}
            </p>
            <p className="text-sm text-slate-600 dark:text-slate-400">
              active member{membersWithoutSlackCount !== 1 ? "s" : ""} with no Slack match
            </p>
            {membersWithoutSlackCount > 0 && (
              <p className="text-xs text-orange-600 dark:text-orange-400 mt-2">
                View unmatched members →
              </p>
            )}
            {membersWithoutSlackCount === 0 && (
              <p className="text-xs text-green-600 dark:text-green-400 mt-2">
                All linked ✓
              </p>
            )}
          </Link>

          {/* Missing Member Data */}
          <Link
            href="/admin/hygiene/missing-member-data"
            className="block p-6 bg-white dark:bg-slate-900 rounded-lg shadow hover:shadow-lg transition-shadow border border-slate-200 dark:border-slate-800"
          >
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-medium text-slate-600 dark:text-slate-400">
                Member Data
              </h3>
              <span className="text-2xl">🔗</span>
            </div>
            <p className="text-3xl font-bold text-slate-900 dark:text-slate-100 mb-1">
              {missingStripeCount ?? 0}
            </p>
            <p className="text-sm text-slate-600 dark:text-slate-400">
              active members missing Stripe ID
            </p>
            {(missingStripeCount ?? 0) > 0 && (
              <p className="text-xs text-orange-600 dark:text-orange-400 mt-2">
                {missingStripeCount} missing Stripe ID →
              </p>
            )}
          </Link>

          {/* Name Aliases */}
          <Link
            href="/admin/data/aliases"
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

          {/* Merge & Fix */}
          <Link
            href="/admin/hygiene/merge-fix"
            className="block p-6 bg-white dark:bg-slate-900 rounded-lg shadow hover:shadow-lg transition-shadow border border-slate-200 dark:border-slate-800"
          >
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-medium text-slate-600 dark:text-slate-400">
                Merge & Fix
              </h3>
              <span className="text-2xl">🔀</span>
            </div>
            <p className="text-3xl font-bold text-slate-900 dark:text-slate-100 mb-1">
              {duplicateCount}
            </p>
            <p className="text-sm text-slate-600 dark:text-slate-400">
              potential duplicate{duplicateCount !== 1 ? "s" : ""} detected
            </p>
            {duplicateCount > 0 && (
              <p className="text-xs text-orange-600 dark:text-orange-400 mt-2">
                {duplicateCount} group{duplicateCount !== 1 ? "s" : ""} to review →
              </p>
            )}
            {duplicateCount === 0 && (
              <p className="text-xs text-green-600 dark:text-green-400 mt-2">
                No duplicates found ✓
              </p>
            )}
          </Link>

          {/* External Conflicts */}
          <Link
            href="/admin/hygiene/external-conflicts"
            className="block p-6 bg-white dark:bg-slate-900 rounded-lg shadow hover:shadow-lg transition-shadow border border-slate-200 dark:border-slate-800"
          >
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-medium text-slate-600 dark:text-slate-400">
                External Conflicts
              </h3>
              <span className="text-2xl">⚡</span>
            </div>
            <p className="text-3xl font-bold text-slate-900 dark:text-slate-100 mb-1">
              ?
            </p>
            <p className="text-sm text-slate-600 dark:text-slate-400">
              duplicate accounts in Kajabi, Stripe, Slack
            </p>
            <p className="text-xs text-blue-600 dark:text-blue-400 mt-2">
              Check for duplicates →
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

          {hostMatchRate < 90 && totalRequiringHosts > 0 && (
            <div className="p-4 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg">
              <div className="flex items-start gap-3">
                <span className="text-xl">💡</span>
                <div className="flex-1">
                  <h3 className="font-semibold text-blue-900 dark:text-blue-100 mb-1">
                    Host assignment opportunities
                  </h3>
                  <p className="text-sm text-blue-800 dark:text-blue-200 mb-2">
                    Some prickles requiring hosts are missing assignments. Update calendar events
                    with &quot;w/[Name]&quot; patterns or set default hosts for prickle types.
                  </p>
                  <p className="text-xs text-blue-700 dark:text-blue-300">
                    Current rate: {hostMatchRate}% ({calendarPricklesWithHost}/{totalRequiringHosts} with host).
                    Visit{" "}
                    <Link href="/admin/data-health/missing-hosts" className="underline hover:text-blue-500">
                      Missing Hosts
                    </Link>{" "}
                    to review and assign.
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

          {stalePrivateChannels.length > 0 && (
            <div className="p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
              <div className="flex items-start gap-3">
                <span className="text-xl">🔒</span>
                <div className="flex-1">
                  <h3 className="font-semibold text-red-900 dark:text-red-100 mb-1">
                    BillieBot lost access to {stalePrivateChannels.length} private Slack channel
                    {stalePrivateChannels.length !== 1 ? "s" : ""}
                  </h3>
                  <p className="text-sm text-red-800 dark:text-red-200 mb-2">
                    These channels stopped showing up in the nightly Slack sync — BillieBot was likely
                    removed from them. Apps can&apos;t invite themselves back into a private channel, so
                    someone who&apos;s already a member needs to manually re-invite BillieBot.
                  </p>
                  <ul className="text-xs text-red-700 dark:text-red-300 space-y-1">
                    {stalePrivateChannels.map((c) => (
                      <li key={c.channelId}>
                        #{c.channelName} — last seen {new Date(c.lastSeenAt).toLocaleDateString()}
                      </li>
                    ))}
                  </ul>
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
            <div className="flex justify-between items-center">
              <span className="text-slate-600 dark:text-slate-400">Last Slack sync:</span>
              <span className="font-medium text-slate-900 dark:text-slate-100">
                {lastSlackSyncAt
                  ? new Date(lastSlackSyncAt).toLocaleString()
                  : "Never"}
              </span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-slate-600 dark:text-slate-400">Last Slack processing:</span>
              <span className="font-medium text-slate-900 dark:text-slate-100">
                {lastSlackProcessing?.created_at
                  ? new Date(lastSlackProcessing.created_at).toLocaleString()
                  : "Never"}
              </span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-slate-600 dark:text-slate-400">Last Kajabi sync:</span>
              <span className="font-medium text-slate-900 dark:text-slate-100">
                {lastKajabiSync?.imported_at
                  ? new Date(lastKajabiSync.imported_at).toLocaleString()
                  : "Never"}
              </span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-slate-600 dark:text-slate-400">Last Kajabi processing:</span>
              <span className="font-medium text-slate-900 dark:text-slate-100">
                {lastKajabiProcessing?.updated_at
                  ? new Date(lastKajabiProcessing.updated_at).toLocaleString()
                  : "Never"}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
