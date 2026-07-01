import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import PrickleDetails from "@/components/PrickleDetails";
import { getUserTimezonePreference } from "@/lib/timezone";
import { findUnmatchedZoomAttendees, findMatchedZoomAttendeesWithoutAttendance } from "@/lib/prickle-unmatched";
import AliasSearchForm from "@/app/(admin)/admin/hygiene/unmatched-zoom/AliasSearchForm";
import { getScheduleSlot } from "@/lib/scheduled-prickle-stats";

export default async function AdminPrickleDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: prickle } = await supabase
    .from("prickles")
    .select(`
      id,
      host:members(id, name),
      start_time,
      end_time,
      source,
      zoom_meeting_uuid,
      type_id,
      prickle_types:type_id(name, description, normalized_name)
    `)
    .eq("id", id)
    .single();

  if (!prickle) {
    return (
      <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100 mb-2">Prickle not found</h1>
          <Link href="/admin/calendar" className="text-blue-600 hover:text-blue-700 dark:text-blue-400">
            ← Back to Calendar
          </Link>
        </div>
      </div>
    );
  }

  const { data: attendanceRecords } = await supabase
    .from("prickle_attendance")
    .select(`
      id,
      join_time,
      leave_time,
      confidence_score,
      member_id,
      members!inner(id, name, email)
    `)
    .eq("prickle_id", id)
    .order("join_time", { ascending: true });

  const host = Array.isArray(prickle.host) ? prickle.host[0] : prickle.host;
  const hostId = host?.id;
  let hostMissing = false;
  let hostLate = false;

  if (hostId) {
    const hostAttendance = attendanceRecords?.find((a: any) => a.member_id === hostId);
    if (!hostAttendance) {
      hostMissing = true;
    } else {
      const prickleStart = new Date(prickle.start_time);
      const hostJoin = new Date(hostAttendance.join_time);
      if (hostJoin.getTime() - prickleStart.getTime() > 5 * 60 * 1000) {
        hostLate = true;
      }
    }
  }

  const userTimezone = await getUserTimezonePreference();

  const [zoomResult, membersResult, aliasesResult, ignoredResult, staffResult] = await Promise.all([
    supabase.schema("bronze").from("zoom_attendees")
      .select("name, email")
      .lt("join_time", prickle.end_time)
      .gt("leave_time", prickle.start_time),
    supabase.from("members").select("id, name, email"),
    supabase.from("member_name_aliases").select("alias, member_id, source"),
    supabase.from("ignored_zoom_names").select("zoom_name"),
    supabase.from("staff").select("name, email"),
  ]);

  const members = membersResult.data || [];
  const aliases = aliasesResult.data || [];
  const ignoredNames = (ignoredResult.data || []).map((i: any) => i.zoom_name);
  const staff = staffResult.data || [];

  const attendedMemberIds = new Set((attendanceRecords || []).map((a: any) => a.member_id));

  const unmatchedZoomAttendees = findUnmatchedZoomAttendees(
    zoomResult.data || [],
    members,
    aliases,
    ignoredNames,
    staff
  );

  const matchedWithoutAttendance = findMatchedZoomAttendeesWithoutAttendance(
    zoomResult.data || [],
    members,
    aliases,
    ignoredNames,
    staff,
    attendedMemberIds
  );

  // Fetch historical meeting counts so "appearances" in the UI reflects all-time data,
  // not just the count within this prickle's time window.
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

  const prickleTypeData = prickle.prickle_types as any;
  const normalizedName = prickleTypeData?.normalized_name as string | undefined;
  let insightsSlotUrl: string | undefined;
  if (normalizedName) {
    const slot = getScheduleSlot(prickle.start_time);
    insightsSlotUrl = `/admin/insights/prickles/${normalizedName}?group=schedule&slot=${encodeURIComponent(slot.sortKey)}`;
  }

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
      <header className="border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
        <div className="container mx-auto px-6 py-4">
          <Link href="/admin/calendar" className="text-blue-600 hover:text-blue-700 dark:text-blue-400 text-sm mb-2 inline-block">
            ← Back to Calendar
          </Link>
          <h1 className="text-2xl font-bold mt-2">Prickle Details</h1>
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
            memberBasePath="/admin/members"
            showMemberEmails={true}
            insightsSlotUrl={insightsSlotUrl}
          />
          {matchedWithoutAttendance.length > 0 && (
            <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg p-4">
              <h3 className="font-semibold text-amber-900 dark:text-amber-100 mb-1">
                Attendance gaps ({matchedWithoutAttendance.length})
              </h3>
              <p className="text-sm text-amber-800 dark:text-amber-200 mb-3">
                These members were recognized in this Zoom meeting but have no attendance record —
                they won&apos;t appear in member stats until attendance is reprocessed for this date range.
              </p>
              <ul className="space-y-1">
                {matchedWithoutAttendance.map(m => (
                  <li key={m.memberId} className="text-sm text-amber-900 dark:text-amber-100">
                    <span className="font-medium">{m.memberName}</span>
                    {m.zoomName !== m.memberName && (
                      <span className="text-amber-700 dark:text-amber-300"> (as &quot;{m.zoomName}&quot;)</span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {unmatchedZoomAttendees.length > 0 && (
            <AliasSearchForm
              unmatchedAttendees={unmatchedZoomAttendees}
              allMembers={members}
            />
          )}
        </div>
      </main>
    </div>
  );
}
