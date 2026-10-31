import { createRepos } from "@/lib/data/repos";
import { attendeeRow } from "@/lib/attendance-view";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import PrickleDetails from "@/components/PrickleDetails";
import { ReturnToTabLink } from "@/components/ReturnToTab";
import { getUserTimezonePreference } from "@/lib/timezone";
import { getEffectiveIdentity } from "@/lib/sudo";
import { findUnmatchedZoomAttendees } from "@/lib/prickle-unmatched";
import IgnoredZoomNames from "@/app/(admin)/admin/prickles/[id]/IgnoredZoomNames";
import AliasSearchForm from "@/app/(admin)/admin/hygiene/unmatched-zoom/AliasSearchForm";
import { prickleTitle } from "@/lib/domain/prickle";
import { computeHostStatus } from "@/lib/hosting-stats";
import { getMyEntriesForPrickle } from "@/app/(member)/projects/actions";
import { getMyCheckin } from "@/app/(member)/prickles/checkin-actions";
import { parseCheckinPrefill } from "@/lib/prickle-checkins";
import PrickleCheckLinks from "@/components/writing/PrickleCheckLinks";
import { getMyCalendarItems } from "@/app/(member)/my-prickles/calendar-feed-actions";
import { AddPrickleToCalendar } from "@/app/(member)/my-prickles/AddToCalendar";
import { prickleCalendarState, SCHEDULE_TIMEZONE } from "@/lib/calendar-feed";
import { slotKey, slotTimeForInstant } from "@/lib/commitments";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { loadPrickleRoster, type PrickleRoster } from "@/lib/prickle-roster";

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

function hasNotStarted(startTime: string): boolean {
  return new Date(startTime).getTime() > Date.now();
}

export default async function PrickleDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ pleasant?: string | string[]; energy?: string | string[]; emotion?: string | string[]; need?: string | string[] }>;
}) {
  const { id } = await params;
  // "Coming in" answers carried from Find a Prickle, to pre-fill an unsaved check-in.
  const checkinPrefill = parseCheckinPrefill((await searchParams) ?? {});
  const supabase = await createClient();

  const user = await getCurrentUser();

  if (!user) {
    redirect("/login");
  }

  const [profileResult, effectiveIdentity, prickle, calendarItems, myPrickleEntries, myCheckin] = await Promise.all([
    createRepos(supabase).profiles.isAdmin(user.id),
    getEffectiveIdentity(user),
    getPrickle(id),
    getMyCalendarItems(),
    getMyEntriesForPrickle(id),
    getMyCheckin(id),
  ]);
  const isAdmin = profileResult;
  const isActingAsAdmin = isAdmin && !effectiveIdentity?.isSudo;
  const memberBasePath = isActingAsAdmin ? "/admin/members" : "/members";
  const backHref = isActingAsAdmin ? "/admin/calendar" : "/my-prickles/history";
  const backLabel = isActingAsAdmin ? "← Back to Calendar" : "← Back to My Prickles";
  // Members go back to the My Prickles tab they came from (e.g. All Prickles), when known.
  const backLink = (className: string) =>
    isActingAsAdmin ? (
      <Link data-track="prickle-page-back" href={backHref} className={className}>
        {backLabel}
      </Link>
    ) : (
      <ReturnToTabLink path="/my-prickles" fallbackHref={backHref} className={className}>
        {backLabel}
      </ReturnToTabLink>
    );

  if (!prickle) {
    return (
      <div className="min-h-screen bg-canvas dark:bg-slate-950 flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100 mb-2">Prickle not found</h1>
          {backLink("text-plum-600 hover:text-plum-700 dark:text-plum-400")}
        </div>
      </div>
    );
  }

  // Attendee emails are admin-only: members can't read other members' rows (RLS), so a member
  // viewer gets names from the public member_directory via the attendance_member computed
  // relationship, and never receives emails.
  const attendeeList = await createRepos(supabase).attendance.attendeesOf(id, { includeEmail: isActingAsAdmin });
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

  let ignoredHere: Array<{ zoomName: string; reason: string | null }> = [];
  let unmatchedZoomAttendees: Array<{ zoomName: string; appearances: number; emails: string[] }> = [];
  let allMembersForMatching: Array<{ id: string; name: string; email: string }> = [];

  if (isActingAsAdmin && prickle) {
    const [zoomResult, membersResult, aliasesResult, ignoredResult, ignoredHereResult, staffResult] = await Promise.all([
      createRepos(supabase).zoom.attendeeNamesOverlapping(prickle.startTime, prickle.endTime),
      createRepos(supabase).members.identities(),
      createRepos(supabase).aliases.nameAliases({ activeOnly: true }),
      createRepos(supabase).zoom.ignoredNames(),
      createRepos(supabase).zoom.ignoredAppearancesOf(prickle.id),
      supabase.from("staff").select("name, email"),
    ]);

    const members = membersResult;
    const aliases = aliasesResult;
    ignoredHere = ignoredHereResult.map((i) => ({ zoomName: i.zoom_name, reason: i.reason }));
    const ignoredNames = [...ignoredResult, ...ignoredHereResult.map((i) => i.zoom_name)];
    const staff = staffResult.data || [];
    allMembersForMatching = members;

    unmatchedZoomAttendees = findUnmatchedZoomAttendees(
      zoomResult,
      members,
      aliases,
      ignoredNames,
      staff
    );

    if (unmatchedZoomAttendees.length > 0) {
      const unmatchedNames = unmatchedZoomAttendees.map(a => a.zoomName);
      const historicalMeetings = await createRepos(supabase).zoom.meetingCountsByName(unmatchedNames);
      for (const a of unmatchedZoomAttendees) {
        a.appearances = historicalMeetings.get(a.zoomName) ?? a.appearances;
      }
    }
  }

  // Members can add an upcoming prickle to their synced calendar (just this one, or every week).
  const prickleHost = prickle.host;
  const typeName = prickle.type?.name ?? "Prickle";
  const scheduleSlot = prickle.typeId
    ? { typeId: prickle.typeId, ...slotTimeForInstant(prickle.startTime, SCHEDULE_TIMEZONE), timezone: SCHEDULE_TIMEZONE }
    : null;
  const calendarControl =
    effectiveIdentity && prickle.typeId && hasNotStarted(prickle.startTime) ? (
      <AddPrickleToCalendar
        prickleId={prickle.id}
        typeName={typeName}
        nextLabel={new Intl.DateTimeFormat("en-US", {
          timeZone: userTimezone === "browser" ? SCHEDULE_TIMEZONE : userTimezone,
          weekday: "short",
          month: "short",
          day: "numeric",
        }).format(new Date(prickle.startTime))}
        state={prickleCalendarState(calendarItems, prickle.id, scheduleSlot ? slotKey(scheduleSlot) : null)}
        autoIncluded={prickleHost?.id === effectiveIdentity.memberId ? "hosting" : null}
      />
    ) : null;

  // Check-in, check-out and logged progress are the viewer's own and live in a modal on My Prickles'
  // Attendance History; here, only a link, and only when it's relevant: before the prickle (to
  // check in) or after it for someone who was there or already has something saved. Admins with a
  // member record get it too (the DM links there).
  const started = !hasNotStarted(prickle.startTime);
  // Who's coming: commitments and calendar items are private rows, so the roster is read with the
  // service role and carries names only. A failure just leaves the "stay tuned" text.
  let roster: PrickleRoster | null = null;
  if (!started) {
    try {
      roster = await loadPrickleRoster(
        createServiceRoleClient(),
        { id: prickle.id, type_id: prickle.typeId, start_time: prickle.startTime, host_id: hostId ?? null },
        effectiveIdentity?.memberId ?? null
      );
    } catch (error) {
      console.error("[prickles] Loading who's coming failed", { prickleId: prickle.id, error });
    }
  }
  const attended = attendanceRecords.some(
    (a) => a.member_id === effectiveIdentity?.memberId
  );
  const checkLinks =
    effectiveIdentity && (!started || attended || myCheckin || myPrickleEntries.length > 0) ? (
      <PrickleCheckLinks
        prickleId={prickle.id}
        hasStarted={started}
        checkin={myCheckin}
        entries={myPrickleEntries}
        prefill={checkinPrefill}
      />
    ) : null;

  return (
    <div className="min-h-screen bg-canvas dark:bg-slate-950">
      <header className="border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
        <div className="container mx-auto px-6 py-4">
          {backLink("text-plum-600 hover:text-plum-700 dark:text-plum-400 text-sm mb-2 inline-block")}
          <div className="flex items-center justify-between gap-3 flex-wrap mt-2">
            <h1 className="text-2xl font-bold">Prickle Details</h1>
            {calendarControl}
          </div>
        </div>
      </header>

      <main className="container mx-auto px-6 py-8">
        <div className="max-w-4xl mx-auto space-y-6">
          {checkLinks}
          <PrickleDetails
            prickle={prickle}
            attendanceRecords={attendanceRecords}
            hostMissing={hostMissing}
            hostLate={hostLate}
            userTimezonePreference={userTimezone}
            memberBasePath={memberBasePath}
            showMemberEmails={isActingAsAdmin}
            hasStarted={started}
            roster={roster}
          />
          {isActingAsAdmin && <IgnoredZoomNames prickleId={prickle.id} items={ignoredHere} />}
          {isActingAsAdmin && unmatchedZoomAttendees.length > 0 && (
            <AliasSearchForm
              unmatchedAttendees={unmatchedZoomAttendees}
              allMembers={allMembersForMatching}
              prickleId={prickle.id}
            />
          )}
        </div>
      </main>
    </div>
  );
}
