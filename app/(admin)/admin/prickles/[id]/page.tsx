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
import { requireAdminPage } from "@/lib/admin-auth";
import TestCheckinDMs from "./TestCheckinDMs";
import ShowInEvents from "./ShowInEvents";
import { updatePrickle } from "./actions";
import { loadEventDecision } from "@/lib/prickle-event-decisions";
import { getUserFeaturePreviews } from "@/lib/features.server";

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
  await requireAdminPage();
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
    createRepos(supabase).members.identities(),
    createRepos(supabase).aliases.nameAliases(),
    createRepos(supabase).zoom.ignoredNames(),
    supabase.from("ignored_zoom_appearances").select("zoom_name, reason").eq("prickle_id", prickle.id),
    createRepos(supabase).staff.all(),
  ]);

  const members = membersResult;
  const aliases = aliasesResult;
  const ignoredHere = (ignoredHereResult.data || []).map((i) => ({ zoomName: i.zoom_name, reason: i.reason }));
  const ignoredNames = [...ignoredResult, ...(ignoredHereResult.data || []).map((i) => i.zoom_name)];
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
            insightsSlotUrl={insightsSlotUrl}
            edit={
              prickle.calendarEventId
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
          {eventsEnabled && prickle.calendarEventId && (
            <ShowInEvents
              calendarEventId={prickle.calendarEventId}
              initial={eventFollowing ? { id: eventFollowing.id, slug: eventFollowing.slug, hidden: eventFollowing.hidden } : null}
            />
          )}
          <TestCheckinDMs prickleId={prickle.id} />
          <IgnoredZoomNames prickleId={prickle.id} items={ignoredHere} />
          {unmatchedZoomAttendees.length > 0 && (
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
