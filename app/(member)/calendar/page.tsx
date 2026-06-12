import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import CalendarWeekView, { type Prickle } from "@/components/CalendarWeekView";
import CalendarScrollContainer from "@/components/CalendarScrollContainer";
import { getUserTimezonePreference } from "@/lib/timezone";
import { getEffectiveIdentity } from "@/lib/sudo";
import MemberAttendanceView from "@/components/MemberAttendanceView";

export default async function MemberCalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; week?: string }>;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const effectiveIdentity = await getEffectiveIdentity(user);
  if (!effectiveIdentity) return null;

  const params = await searchParams;
  const view = params.view === "week" ? "week" : "month";
  const userTimezone = await getUserTimezonePreference();

  // Fetch all attended records with prickle details (used by both views)
  const { data: attendance } = await supabase
    .from("prickle_attendance")
    .select(`
      id,
      join_time,
      leave_time,
      prickles(
        id,
        host:members(id, name),
        start_time,
        end_time,
        prickle_types(name)
      )
    `)
    .eq("member_id", effectiveIdentity.memberId)
    .order("join_time", { ascending: false });

  // --- Week view: parse week param and derive prickle list from attendance ---
  let weekStart: Date;
  if (params.week) {
    const [year, month, day] = params.week.split("-").map(Number);
    const paramDate = new Date(year, month - 1, day);
    const dayOfWeek = paramDate.getDay();
    weekStart = new Date(paramDate);
    weekStart.setDate(paramDate.getDate() - dayOfWeek);
    weekStart.setHours(0, 0, 0, 0);
  } else {
    const now = new Date();
    weekStart = new Date(now);
    weekStart.setDate(now.getDate() - now.getDay() - 7);
    weekStart.setHours(0, 0, 0, 0);
  }

  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekStart.getDate() + 7);
  weekEnd.setHours(0, 0, 0, 0);

  const prevWeek = new Date(weekStart);
  prevWeek.setDate(weekStart.getDate() - 7);
  const nextWeek = new Date(weekStart);
  nextWeek.setDate(weekStart.getDate() + 7);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const isNextDisabled = nextWeek.getTime() > today.getTime();
  const formatWeekParam = (date: Date) => date.toISOString().split("T")[0];

  // Deduplicate attended prickles in the week (multiple attendance records per prickle due to leave/rejoin)
  const seenPrickleIds = new Set<string>();
  const pricklesForWeek: Prickle[] = [];
  for (const record of attendance ?? []) {
    const joinTime = new Date(record.join_time);
    if (joinTime < weekStart || joinTime >= weekEnd) continue;
    const prickle = record.prickles as any;
    if (!prickle || seenPrickleIds.has(prickle.id)) continue;
    seenPrickleIds.add(prickle.id);
    pricklesForWeek.push({
      id: prickle.id,
      start_time: prickle.start_time,
      end_time: prickle.end_time,
      prickle_type: prickle.prickle_types?.name ?? "Unknown",
      attendance_count: 1,
      host: "",
    });
  }

  return (
    <div className="container mx-auto px-6 py-8">
      <div className="mb-6">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <h1 className="text-2xl font-bold">My Attendance</h1>
          <div className="flex items-center gap-3">
            {/* View toggle */}
            <div className="flex bg-slate-100 dark:bg-slate-800 rounded-lg p-1">
              <Link
                href="/calendar?view=month"
                className={`px-4 py-1.5 text-sm font-medium rounded-md transition-colors ${
                  view === "month"
                    ? "bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 shadow-sm"
                    : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200"
                }`}
              >
                Month
              </Link>
              <Link
                href={`/calendar?view=week&week=${formatWeekParam(weekStart)}`}
                className={`px-4 py-1.5 text-sm font-medium rounded-md transition-colors ${
                  view === "week"
                    ? "bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 shadow-sm"
                    : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200"
                }`}
              >
                Week
              </Link>
            </div>
            {/* Week navigation */}
            {view === "week" && (
              <div className="flex items-center gap-2">
                <Link
                  href={`/calendar?view=week&week=${formatWeekParam(prevWeek)}`}
                  className="px-3 py-2 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg text-slate-700 dark:text-slate-300 transition-colors"
                >
                  ← Previous
                </Link>
                {isNextDisabled ? (
                  <span className="px-3 py-2 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-400 dark:text-slate-600 cursor-not-allowed">
                    Next →
                  </span>
                ) : (
                  <Link
                    href={`/calendar?view=week&week=${formatWeekParam(nextWeek)}`}
                    className="px-3 py-2 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 transition-colors"
                  >
                    Next →
                  </Link>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {view === "week" ? (
        <CalendarScrollContainer
          prickleStartTimes={pricklesForWeek.map((p) => p.start_time)}
          timezone={userTimezone}
        >
          <CalendarWeekView
            prickles={pricklesForWeek}
            weekStartDate={{
              year: weekStart.getFullYear(),
              month: weekStart.getMonth(),
              day: weekStart.getDate(),
            }}
            userTimezonePreference={userTimezone}
            mode="member"
          />
        </CalendarScrollContainer>
      ) : (
        <MemberAttendanceView
          member={{ id: effectiveIdentity.memberId }}
          attendanceRecords={attendance || []}
          userTimezonePreference={userTimezone}
          memberBasePath="/members"
        />
      )}
    </div>
  );
}
