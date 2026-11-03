import { createRepos } from "@/lib/data/repos";
import { attendeeRow } from "@/lib/attendance-view";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import PrickleDetails from "@/components/PrickleDetails";
import { getUserTimezonePreference } from "@/lib/timezone";
import { findUnmatchedZoomAttendees } from "@/lib/prickle-unmatched";
import IgnoredZoomNames from "./IgnoredZoomNames";
import AliasSearchForm from "@/app/(admin)/admin/hygiene/unmatched-zoom/AliasSearchForm";
import { getScheduleSlot } from "@/lib/scheduled-prickle-stats";
import { prickleTitle } from "@/lib/domain/prickle";
import { computeHostStatus } from "@/lib/hosting-stats";
import { requireStaffPage } from "@/lib/admin-auth";
import { staffCan, type StaffFeature } from "@/lib/staff-access";
import TestCheckinDMs from "./TestCheckinDMs";
import ShowInEvents from "./ShowInEvents";
import { updatePrickle } from "./actions";
import { loadEventDecision } from "@/lib/prickle-event-decisions";
import { getUserFeaturePreviews } from "@/lib/features.server";
import { getServiceRepos } from "@/lib/data/server";
import { loadLiveAttendance } from "@/lib/live-attendance";
import LivePoll from "@/components/LivePoll";

const LIVE_POLL_MS = 30_000;
/** Prickles this close are the neighbours the short-stay rule looks at. */
const NEIGHBOUR_MS = 3 * 60 * 60 * 1000;

const getPrickle = cache(async (id: string) => {
  const supabase = await createClient();
  return createRepos(supabase).prickles.byId(id);
});

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const prickle = await getPrickle(id);

  if (!prickle) return { title: "Prickle" };

  return { title: prickleTitle(prickle) };
}

export default async function AdminPrickleDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  // Every control is a staff feature a community manager has only if granted (lib/staff-access.ts).
  const role = (await requireStaffPage()).role;
  const can = (feature: StaffFeature) => staffCan(role, feature);
  const { id } = await params;
  const supabase = await createClient();

  const user = await getCurrentUser();

  if (!user) {
    redirect("/login");
  }

  const prickle = await getPrickle(id);

  if (!prickle) {
    return (
      <div className="min-h-screen bg-canvas dark:bg-slate-950 flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100 mb-2">Prickle not found</h1>
          <Link href="/admin/calendar" className="text-plum-600 hover:text-plum-700 dark:text-plum-400">
            ← Back to Calendar
          </Link>
        </div>
      </div>
    );
  }

  const attendeeList = await createRepos(supabase).attendance.attendeesOf(id, { includeEmail: true });
  const attendanceRecords = attendeeList.map(attendeeRow);

  // While it runs (or just after), the import has nothing yet: add who the join/leave webhooks put in the room,
  // for members the import doesn't have. A failed read leaves the imported attendance, as before.
  const now = new Date();
  const running = new Date(prickle.startTime) <= now && new Date(prickle.endTime) > now;
  const identities = await createRepos(supabase).members.identities();
  try {
    const neighbours = await createRepos(supabase).prickles.startingBetween({
      from: new Date(new Date(prickle.startTime).getTime() - NEIGHBOUR_MS).toISOString(),
      to: new Date(new Date(prickle.endTime).getTime() + NEIGHBOUR_MS).toISOString(),
    });
    const windows = [...neighbours.filter((p) => p.id !== prickle.id), prickle];
    const live = (await loadLiveAttendance(getServiceRepos(), windows, now)).get(prickle.id) ?? [];
    const imported = new Set(attendanceRecords.map((a) => a.member_id));
    const byId = new Map(identities.map((m) => [m.id, m]));
    live.forEach((a, i) => {
      const m = byId.get(a.memberId);
      if (imported.has(a.memberId) || !m) return;
      attendanceRecords.push({
        id: `live-${i}`,
        join_time: a.joinTime,
        leave_time: a.leaveTime,
        confidence_score: "live",
        member_id: a.memberId,
        members: { id: m.id, name: m.name, display_name: m.displayName, email: m.email },
      } as (typeof attendanceRecords)[number]);
    });
    attendanceRecords.sort((a, b) => a.join_time.localeCompare(b.join_time));
  } catch (error) {
    console.error("Live attendance for the admin prickle page failed:", error);
  }

  const hostId = prickle.host?.id;
  let hostMissing = false;
  let hostLate = false;

  if (hostId) {
    // Records are ordered by join_time, so the first match is the host's earliest join.
    const hostAttendance = attendanceRecords.find((a) => a.member_id === hostId);
    const hostStatus = computeHostStatus(prickle.startTime, prickle.endTime, hostAttendance?.join_time ?? null);
    hostMissing = hostStatus === "missing";
    hostLate = hostStatus === "late";
  }

  const userTimezone = await getUserTimezonePreference();

  const [zoomResult, membersResult, aliasesResult, ignoredResult, ignoredHereResult, staffResult] = await Promise.all([
    createRepos(supabase).zoom.attendeeNamesOverlapping(prickle.startTime, prickle.endTime),
    Promise.resolve(identities),
    createRepos(supabase).aliases.nameAliases(),
    createRepos(supabase).zoom.ignoredNames(),
    createRepos(supabase).zoom.ignoredAppearancesOf(prickle.id),
    createRepos(supabase).staff.all(),
  ]);

  const members = membersResult;
  const aliases = aliasesResult;
  const ignoredHere = ignoredHereResult.map((i) => ({ zoomName: i.zoom_name, reason: i.reason }));
  const ignoredNames = [...ignoredResult, ...ignoredHereResult.map((i) => i.zoom_name)];

  const staff = staffResult;

  const unmatchedZoomAttendees = findUnmatchedZoomAttendees(
    zoomResult,
    members,
    aliases,
    ignoredNames,
    staff
  );

  // Fetch historical meeting counts so "appearances" in the UI reflects all-time data,
  // not just the count within this prickle's time window.
  if (unmatchedZoomAttendees.length > 0) {
    const unmatchedNames = unmatchedZoomAttendees.map(a => a.zoomName);
    const historicalMeetings = await createRepos(supabase).zoom.meetingCountsByName(unmatchedNames);
    for (const a of unmatchedZoomAttendees) {
      a.appearances = historicalMeetings.get(a.zoomName) ?? a.appearances;
    }
  }

  // The event that follows this prickle's calendar event, if it has one (events are behind a feature preview).
  const eventsEnabled = (await getUserFeaturePreviews(user.id)).includes("events");
  const eventFollowing =
    eventsEnabled && prickle.calendarEventId
      ? await createRepos(supabase).events.byCalendarEventId(prickle.calendarEventId)
      : null;

  // What an admin can change on a calendar prickle, and what they have already set by hand.
  const calendarTypes = prickle.calendarEventId ? (await createRepos(supabase).prickles.types()).map((t) => ({ id: t.id, name: t.name })) : [];
  const decision = prickle.calendarEventId
    ? await loadEventDecision(supabase, prickle.calendarEventId)
    : { resolved_title: null, resolved_description: null, resolved_guest_speaker: null, resolved_location: null };

  const normalizedName = prickle.type?.normalizedName;
  let insightsSlotUrl: string | undefined;
  if (normalizedName) {
    const slot = getScheduleSlot(prickle.startTime);
    insightsSlotUrl = `/admin/insights/prickles/${normalizedName}?group=schedule&slot=${encodeURIComponent(slot.sortKey)}`;
  }

  return (
    <div className="min-h-screen bg-canvas dark:bg-slate-950">
      <header className="border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
        <div className="container mx-auto px-6 py-4">
          <Link href="/admin/calendar" className="text-plum-600 hover:text-plum-700 dark:text-plum-400 text-sm mb-2 inline-block">
            ← Back to Calendar
          </Link>
          <h1 className="text-2xl font-bold mt-2">Prickle Details</h1>
        </div>
      </header>

      {/* Participant events are service role only, so Realtime can't announce them: while it runs, re-read now and then. */}
      {running && <LivePoll everyMs={LIVE_POLL_MS} />}
      <main className="container mx-auto px-6 py-8">
        <div className="max-w-4xl mx-auto space-y-6">
          <PrickleDetails
            prickle={prickle}
            attendanceRecords={attendanceRecords}
            hostMissing={hostMissing}
            hostLate={hostLate}
            userTimezonePreference={userTimezone}
            memberBasePath="/admin/members"
            showMemberEmails={true}
            insightsSlotUrl={can("prickle.insights_link") ? insightsSlotUrl : undefined}
            edit={
              prickle.calendarEventId && can("prickle.edit")
                ? {
                    types: calendarTypes,
                    members: members.map((m) => ({ id: m.id, name: m.name, displayName: m.displayName, email: m.email })),
                    overridden: {
                      title: decision.resolved_title !== null,
                      description: decision.resolved_description !== null,
                      guestSpeaker: decision.resolved_guest_speaker !== null,
                      location: decision.resolved_location !== null,
                    },
                    onSave: updatePrickle.bind(null, prickle.id),
                  }
                : undefined
            }
          />
          {can("prickle.show_in_events") && eventsEnabled && prickle.calendarEventId && (
            <ShowInEvents
              calendarEventId={prickle.calendarEventId}
              initial={eventFollowing ? { id: eventFollowing.id, slug: eventFollowing.slug, hidden: eventFollowing.hidden } : null}
            />
          )}
          {can("prickle.test_dms") && <TestCheckinDMs prickleId={prickle.id} />}
          {can("prickle.ignore_names") && <IgnoredZoomNames prickleId={prickle.id} items={ignoredHere} />}
          {can("prickle.alias_form") && unmatchedZoomAttendees.length > 0 && (
            <AliasSearchForm
              unmatchedAttendees={unmatchedZoomAttendees}
              allMembers={members}
              prickleId={prickle.id}
            />
          )}
        </div>
      </main>
    </div>
  );
}
