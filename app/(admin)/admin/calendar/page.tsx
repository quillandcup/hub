import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import CalendarWeekView from "@/components/CalendarWeekView";
import CalendarKeyboardNav from "@/components/CalendarKeyboardNav";
import { getUserTimezonePreference } from "@/lib/timezone";
import { computeHostStatus } from "@/lib/hosting-stats";
import { requireAdminPage } from "@/lib/admin-auth";
import { orgWeek } from "@/lib/org-week";
import { formatDateOnly } from "@/lib/formatters";
import { clock } from "@/lib/clock";

export const metadata: Metadata = {
  title: "Prickle Calendar",
};

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ week?: string }>;
}) {
  await requireAdminPage();
  const supabase = await createClient();

  // Await searchParams in Next.js 15
  const params = await searchParams;

  // The week (Sunday to Sunday) in the org's zone, from the URL param or the current one
  const week = orgWeek(params.week, new Date(clock.now()));
  const prevWeekParam = week.prev;
  const nextWeekParam = week.next;

  // Disable next button if it would go into the future (beyond current week)
  const isNextDisabled = week.next > week.today;

  // Fetch prickles for the current week with attendance counts and host
  const { data: prickles, error: pricklesError } = await supabase
    .from("prickles")
    .select(`
      id,
      host:members(id, name),
      start_time,
      end_time,
      type_id,
      prickle_types:type_id(name),
      prickle_attendance(id, member_id, join_time)
    `)
    .gte("start_time", week.startInstant.toISOString())
    .lt("start_time", week.endInstant.toISOString())
    .order("start_time", { ascending: true });

  if (pricklesError) {
    console.error("Error fetching prickles:", pricklesError);
    throw pricklesError;
  }

  // Zoom attendance is imported after the fact. If a meeting at or after a prickle's start is
  // already in, that prickle's data is in too, so 0 attendees means nobody came.
  const { data: latestMeeting } = await supabase
    .schema("bronze")
    .from("zoom_meetings")
    .select("start_time")
    .order("start_time", { ascending: false })
    .limit(1)
    .maybeSingle();

  // Get user's timezone preference
  const userTimezone = await getUserTimezonePreference();

  // Transform the data to include attendance count and host attendance status
  const pricklesWithCount = prickles?.map((prickle: any) => {
    // Handle host as array or object (Supabase foreign key can return either)
    const host = Array.isArray(prickle.host) ? prickle.host[0] : prickle.host;
    const hostId = host?.id;
    let hostMissing = false;
    let hostLate = false;

    if (hostId) {
      // A host can leave/rejoin (multiple attendance rows per prickle), so punctuality is judged
      // by their earliest join_time, not just whichever record comes back first.
      const hostAttendanceRecords = (prickle.prickle_attendance ?? []).filter(
        (a: any) => a.member_id === hostId
      );
      const earliestJoinTime =
        hostAttendanceRecords.length > 0
          ? hostAttendanceRecords.reduce(
              (min: string, a: any) => (a.join_time < min ? a.join_time : min),
              hostAttendanceRecords[0].join_time
            )
          : null;
      const punctuality = computeHostStatus(prickle.start_time, prickle.end_time, earliestJoinTime);
      hostMissing = punctuality === "missing";
      hostLate = punctuality === "late";
    }

    return {
      id: prickle.id,
      host: host?.name || null,
      host_id: hostId,
      start_time: prickle.start_time,
      end_time: prickle.end_time,
      prickle_type: prickle.prickle_types?.name || "Unknown",
      attendance_count: new Set(prickle.prickle_attendance?.map((a: any) => a.member_id) || []).size,
      host_missing: hostMissing,
      host_late: hostLate,
    };
  }) || [];

  return (
    <div className="container mx-auto px-6 py-8">
      {/* Page Header */}
      <div className="mb-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Prickle Calendar</h1>
            <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
              Week of {formatDateOnly(week.start)} - Color intensity shows attendance levels
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Link
              href="/admin/calendar"
              data-track="admin-calendar-today"
              title="Jump to this week (t)"
              className="px-3 py-2 border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg text-slate-700 dark:text-slate-300 transition-colors"
            >
              Today
            </Link>
            <Link
              href={`/admin/calendar?week=${prevWeekParam}`}
              title="Previous week (p)"
              className="px-3 py-2 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg text-slate-700 dark:text-slate-300 transition-colors"
            >
              ← Previous
            </Link>
            {isNextDisabled ? (
              <span
                className="px-3 py-2 rounded-lg transition-colors bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-600 cursor-not-allowed"
                aria-disabled="true"
              >
                Next →
              </span>
            ) : (
              <Link
                href={`/admin/calendar?week=${nextWeekParam}`}
                className="px-3 py-2 rounded-lg transition-colors bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300"
              >
                Next →
              </Link>
            )}
          </div>
        </div>
      </div>
      <CalendarKeyboardNav
        prevHref={`/admin/calendar?week=${prevWeekParam}`}
        nextHref={isNextDisabled ? null : `/admin/calendar?week=${nextWeekParam}`}
        todayHref="/admin/calendar"
      />
      <div className="overflow-x-auto -mx-6 px-6 sm:mx-0 sm:px-0">
        <CalendarWeekView
          prickles={pricklesWithCount}
          weekStartDate={{
            year: Number(week.start.slice(0, 4)),
            month: Number(week.start.slice(5, 7)) - 1,
            day: Number(week.start.slice(8, 10)),
          }}
          userTimezonePreference={userTimezone}
          prickleBasePath="/admin/prickles"
          attendanceDataThrough={latestMeeting?.start_time ?? null}
        />
      </div>
    </div>
  );
}
