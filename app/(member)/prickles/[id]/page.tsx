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
import AliasSearchForm from "@/app/(admin)/admin/hygiene/unmatched-zoom/AliasSearchForm";
import { formatPrickleTitle } from "@/lib/formatters";
import { computeHostStatus } from "@/lib/hosting-stats";
import { getMyProjects } from "@/app/(member)/projects/actions";
import { getMyCalendarItems } from "@/app/(member)/my-prickles/calendar-feed-actions";
import { AddPrickleToCalendar } from "@/app/(member)/my-prickles/AddToCalendar";
import { prickleCalendarState, SCHEDULE_TIMEZONE } from "@/lib/calendar-feed";
import { slotKey, slotTimeForInstant } from "@/lib/commitments";

const getPrickle = cache(async (id: string) => {
  const supabase = await createClient();
  const { data } = await supabase
    .from("prickles")
    .select(`
      id,
      host:prickle_host(id, name),
      start_time,
      end_time,
      source,
      zoom_meeting_uuid,
      type_id,
      prickle_types:type_id(name, description)
    `)
    .eq("id", id)
    .single();
  return data;
});

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const prickle = await getPrickle(id);

  if (!prickle) return { title: "Prickle" };

  return { title: formatPrickleTitle(prickle) };
}

function hasNotStarted(startTime: string): boolean {
  return new Date(startTime).getTime() > Date.now();
}

export default async function PrickleDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const user = await getCurrentUser();

  if (!user) {
    redirect("/login");
  }

  const [profileResult, effectiveIdentity, prickle, myProjects, calendarItems] = await Promise.all([
    supabase.from("user_profiles").select("role").eq("id", user.id).single(),
    getEffectiveIdentity(user),
    getPrickle(id),
    getMyProjects(),
    getMyCalendarItems(),
  ]);
  const isAdmin = profileResult.data?.role === "admin";
  const isActingAsAdmin = isAdmin && !effectiveIdentity?.isSudo;
  const memberBasePath = isActingAsAdmin ? "/admin/members" : "/members";
  const backHref = isActingAsAdmin ? "/admin/calendar" : "/my-prickles?tab=history";
  const backLabel = isActingAsAdmin ? "← Back to Calendar" : "← Back to My Prickles";
  // Members go back to the My Prickles tab they came from (e.g. All Prickles), when known.
  const backLink = (className: string) =>
    isActingAsAdmin ? (
      <Link href={backHref} className={className}>
        {backLabel}
      </Link>
    ) : (
      <ReturnToTabLink path="/my-prickles" fallbackHref={backHref} className={className}>
        {backLabel}
      </ReturnToTabLink>
    );

  if (!prickle) {
    return (
      <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100 mb-2">Prickle not found</h1>
          {backLink("text-blue-600 hover:text-blue-700 dark:text-blue-400")}
        </div>
      </div>
    );
  }

  // Attendee emails are admin-only: members can't read other members' rows (RLS), so a member
  // viewer gets names from the public member_directory via the attendance_member computed
  // relationship, and never receives emails.
  const { data: attendanceRecords } = await supabase
    .from("prickle_attendance")
    .select(
      isActingAsAdmin
        ? "id, join_time, leave_time, confidence_score, member_id, members!inner(id, name, email)"
        : "id, join_time, leave_time, confidence_score, member_id, members:attendance_member!inner(id, name)"
    )
    .eq("prickle_id", id)
    .order("join_time", { ascending: true });

  const host = Array.isArray(prickle.host) ? prickle.host[0] : prickle.host;
  const hostId = host?.id;
  let hostMissing = false;
  let hostLate = false;

  if (hostId) {
    // Records are ordered by join_time, so the first match is the host's earliest join.
    const hostAttendance = attendanceRecords?.find((a: any) => a.member_id === hostId);
    const hostStatus = computeHostStatus(prickle.start_time, prickle.end_time, hostAttendance?.join_time ?? null);
    hostMissing = hostStatus === "missing";
    hostLate = hostStatus === "late";
  }

  const userTimezone = await getUserTimezonePreference();

  let unmatchedZoomAttendees: Array<{ zoomName: string; appearances: number; emails: string[] }> = [];
  let allMembersForMatching: Array<{ id: string; name: string; email: string }> = [];

  if (isActingAsAdmin && prickle) {
    const [zoomResult, membersResult, aliasesResult, ignoredResult, staffResult] = await Promise.all([
      supabase.schema("bronze").from("zoom_attendees")
        .select("name, email")
        .lt("join_time", prickle.end_time)
        .gt("leave_time", prickle.start_time),
      supabase.from("members").select("id, name, email"),
      supabase.from("member_name_aliases").select("alias, member_id, source").eq("active", true),
      supabase.from("ignored_zoom_names").select("zoom_name"),
      supabase.from("staff").select("name, email"),
    ]);

    const members = membersResult.data || [];
    const aliases = aliasesResult.data || [];
    const ignoredNames = (ignoredResult.data || []).map((i: any) => i.zoom_name);
    const staff = staffResult.data || [];
    allMembersForMatching = members;

    unmatchedZoomAttendees = findUnmatchedZoomAttendees(
      zoomResult.data || [],
      members,
      aliases,
      ignoredNames,
      staff
    );

    if (unmatchedZoomAttendees.length > 0) {
      const unmatchedNames = unmatchedZoomAttendees.map(a => a.zoomName);
      const { data: historicalAttendees } = await supabase
        .schema("bronze").from("zoom_attendees")
        .select("name, meeting_uuid")
        .in("name", unmatchedNames)
        .not("meeting_uuid", "is", null);

      if (historicalAttendees) {
        const historicalMeetings = new Map<string, Set<string>>();
        for (const a of historicalAttendees) {
          if (!historicalMeetings.has(a.name)) historicalMeetings.set(a.name, new Set());
          historicalMeetings.get(a.name)!.add(a.meeting_uuid);
        }
        for (const a of unmatchedZoomAttendees) {
          a.appearances = historicalMeetings.get(a.zoomName)?.size ?? a.appearances;
        }
      }
    }
  }

  // Members can add an upcoming prickle to their synced calendar (just this one, or every week).
  const prickleHost = Array.isArray(prickle.host) ? prickle.host[0] : prickle.host;
  const typeName =
    (Array.isArray(prickle.prickle_types) ? prickle.prickle_types[0] : prickle.prickle_types)?.name ?? "Prickle";
  const scheduleSlot = prickle.type_id
    ? { typeId: prickle.type_id, ...slotTimeForInstant(prickle.start_time, SCHEDULE_TIMEZONE), timezone: SCHEDULE_TIMEZONE }
    : null;
  const calendarControl =
    !isActingAsAdmin && effectiveIdentity && prickle.type_id && hasNotStarted(prickle.start_time) ? (
      <AddPrickleToCalendar
        prickleId={prickle.id}
        typeName={typeName}
        nextLabel={new Intl.DateTimeFormat("en-US", {
          timeZone: userTimezone === "browser" ? SCHEDULE_TIMEZONE : userTimezone,
          weekday: "short",
          month: "short",
          day: "numeric",
        }).format(new Date(prickle.start_time))}
        state={prickleCalendarState(
          calendarItems,
          { typeId: prickle.type_id, startTime: prickle.start_time },
          scheduleSlot ? slotKey(scheduleSlot) : null
        )}
        autoIncluded={prickleHost?.id === effectiveIdentity.memberId ? "hosting" : null}
      />
    ) : null;

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
      <header className="border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
        <div className="container mx-auto px-6 py-4">
          {backLink("text-blue-600 hover:text-blue-700 dark:text-blue-400 text-sm mb-2 inline-block")}
          <div className="flex items-center justify-between gap-3 flex-wrap mt-2">
            <h1 className="text-2xl font-bold">Prickle Details</h1>
            {calendarControl}
          </div>
        </div>
      </header>

      <main className="container mx-auto px-6 py-8">
        <div className="max-w-4xl mx-auto space-y-6">
          <PrickleDetails
            prickle={prickle}
            attendanceRecords={attendanceRecords || []}
            hostMissing={hostMissing}
            hostLate={hostLate}
            userTimezonePreference={userTimezone}
            memberBasePath={memberBasePath}
            showMemberEmails={isActingAsAdmin}
            viewerMemberId={effectiveIdentity?.memberId ?? null}
            viewerProjects={myProjects.map((p) => ({ id: p.id, title: p.title }))}
          />
          {isActingAsAdmin && unmatchedZoomAttendees.length > 0 && (
            <AliasSearchForm
              unmatchedAttendees={unmatchedZoomAttendees}
              allMembers={allMembersForMatching}
            />
          )}
        </div>
      </main>
    </div>
  );
}
