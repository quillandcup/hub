import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import CalendarWeekView from "@/components/CalendarWeekView";
import { getUserTimezonePreference } from "@/lib/timezone";
import { computeHostPunctuality } from "@/lib/hosting-stats";

export const metadata: Metadata = {
  title: "Prickle Calendar",
};

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ week?: string }>;
}) {
  const supabase = await createClient();

  // Await searchParams in Next.js 15
  const params = await searchParams;

  // Get week from URL param or default to last week
  let weekStart: Date;
  if (params.week) {
    // Parse week from URL (format: YYYY-MM-DD) and normalize to Sunday
    // Use local timezone parsing to avoid UTC shift issues
    const [year, month, day] = params.week.split('-').map(Number);
    const paramDate = new Date(year, month - 1, day); // month is 0-indexed
    const dayOfWeek = paramDate.getDay(); // 0 = Sunday
    weekStart = new Date(paramDate);
    weekStart.setDate(paramDate.getDate() - dayOfWeek); // Adjust to Sunday
    weekStart.setHours(0, 0, 0, 0);
  } else {
    // Default to last week (7 days ago, starting on Sunday)
    const now = new Date();
    const dayOfWeek = now.getDay(); // 0 = Sunday
    weekStart = new Date(now);
    weekStart.setDate(now.getDate() - dayOfWeek - 7); // Last Sunday
    weekStart.setHours(0, 0, 0, 0);
  }

  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekStart.getDate() + 7);
  weekEnd.setHours(0, 0, 0, 0);

  // Calculate prev/next week dates for navigation
  const prevWeek = new Date(weekStart);
  prevWeek.setDate(weekStart.getDate() - 7);
  const nextWeek = new Date(weekStart);
  nextWeek.setDate(weekStart.getDate() + 7);
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Format dates for URL params (YYYY-MM-DD)
  const formatWeekParam = (date: Date) => date.toISOString().split("T")[0];
  const prevWeekParam = formatWeekParam(prevWeek);
  const nextWeekParam = formatWeekParam(nextWeek);

  // Disable next button if it would go into the future (beyond current week)
  const isNextDisabled = nextWeek.getTime() > today.getTime();

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
    .gte("start_time", weekStart.toISOString())
    .lt("start_time", weekEnd.toISOString())
    .order("start_time", { ascending: true });

  if (pricklesError) {
    console.error("Error fetching prickles:", pricklesError);
    throw pricklesError;
  }

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
      const punctuality = computeHostPunctuality(prickle.start_time, earliestJoinTime);
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
              Week of {weekStart.toLocaleDateString()} - Color intensity shows attendance levels
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Link
              href={`/admin/calendar?week=${prevWeekParam}`}
              className="px-3 py-2 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg text-slate-700 dark:text-slate-300 transition-colors"
            >
              ← Previous
            </Link>
            {isNextDisabled ? (
              <span
                className="px-3 py-2 rounded-lg transition-colors bg-slate-100 dark:bg-slate-800 text-slate-400 dark:text-slate-600 cursor-not-allowed"
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
      <div className="overflow-x-auto -mx-6 px-6 sm:mx-0 sm:px-0">
        <CalendarWeekView
          prickles={pricklesWithCount}
          weekStartDate={{
            year: weekStart.getFullYear(),
            month: weekStart.getMonth(),
            day: weekStart.getDate()
          }}
          userTimezonePreference={userTimezone}
          prickleBasePath="/admin/prickles"
        />
      </div>
    </div>
  );
}
