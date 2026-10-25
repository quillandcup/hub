import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { createRepos } from "@/lib/data/repos";
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

  // The week's prickles (type and host joined in) and who attended each
  const repos = createRepos(supabase);
  const prickles = await repos.prickles.startingBetween({ from: week.startInstant.toISOString(), to: week.endInstant.toISOString() });
  const attendanceByPrickle = new Map<string, { memberId: string; joinTime: string }[]>();
  for (const link of await repos.attendance.forPrickles(prickles.map((p) => p.id))) {
    attendanceByPrickle.set(link.prickleId, [...(attendanceByPrickle.get(link.prickleId) ?? []), link]);
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
  const pricklesWithCount = prickles.map((prickle) => {
    const attendance = attendanceByPrickle.get(prickle.id) ?? [];
    const hostId = prickle.hostId;
    let hostMissing = false;
    let hostLate = false;

    if (hostId) {
      // A host can leave/rejoin (multiple attendance rows per prickle), so punctuality is judged
      // by their earliest join_time, not just whichever record comes back first.
      const hostJoins = attendance.filter((a) => a.memberId === hostId).map((a) => a.joinTime);
      const earliestJoinTime = hostJoins.length > 0 ? hostJoins.reduce((min, t) => (t < min ? t : min)) : null;
      const punctuality = computeHostStatus(prickle.startTime, prickle.endTime, earliestJoinTime);
      hostMissing = punctuality === "missing";
      hostLate = punctuality === "late";
    }

    return {
      id: prickle.id,
      host: prickle.host?.name ?? "",
      host_id: hostId ?? undefined,
      start_time: prickle.startTime,
      end_time: prickle.endTime,
      prickle_type: prickle.type?.name || "Unknown",
      attendance_count: new Set(attendance.map((a) => a.memberId)).size,
      host_missing: hostMissing,
      host_late: hostLate,
    };
  });

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
      {/* The scroller bleeds to the screen edges on a phone and carries no padding of its own: the calendar's sticky
          time column sticks at a scroller's content edge, so padding on the scroller leaves a gap beside it. The
          page margin is on the box inside. */}
      <div className="overflow-x-auto -mx-6 sm:mx-0">
        <div className="px-6 sm:px-0">
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
    </div>
  );
}
