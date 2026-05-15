import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import CalendarWeekView from "@/components/CalendarWeekView";
import CalendarScrollContainer from "@/components/CalendarScrollContainer";
import { getUserTimezonePreference } from "@/lib/timezone";

export default async function MemberCalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ week?: string }>;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  // Layout guarantees user is authenticated; assertion satisfies TypeScript.
  if (!user) return null;

  const params = await searchParams;

  // Parse week from URL param or default to last week
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
    const dayOfWeek = now.getDay();
    weekStart = new Date(now);
    weekStart.setDate(now.getDate() - dayOfWeek - 7);
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

  // Resolve the member record for this user by email
  const { data: member } = await supabase
    .from("members")
    .select("id, name")
    .eq("email", user.email!)
    .single();

  if (!member) {
    return (
      <div className="container mx-auto px-6 py-8">
        <div className="bg-white dark:bg-slate-900 rounded-lg p-8 text-center border border-slate-200 dark:border-slate-800">
          <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100 mb-2">
            Account not linked
          </h2>
          <p className="text-slate-600 dark:text-slate-400">
            Your account isn&apos;t linked to a member profile yet. Contact an
            admin.
          </p>
        </div>
      </div>
    );
  }

  // Fetch all prickles for the week
  const { data: prickles, error: pricklesError } = await supabase
    .from("prickles")
    .select("id, start_time, end_time, type_id, prickle_types:type_id(name)")
    .gte("start_time", weekStart.toISOString())
    .lt("start_time", weekEnd.toISOString())
    .order("start_time", { ascending: true });

  if (pricklesError) throw pricklesError;

  // Fetch prickles this member attended during the week
  const { data: attended } = await supabase
    .from("prickle_attendance")
    .select("prickle_id")
    .eq("member_id", member.id)
    .gte("join_time", weekStart.toISOString())
    .lt("join_time", weekEnd.toISOString());

  const attendedIds = new Set(attended?.map((a) => a.prickle_id) ?? []);

  // Shape data to match CalendarWeekView Prickle interface.
  // attendance_count: 1 = attended, 0 = did not attend.
  // host must be a string per the interface; use empty string when not applicable.
  const pricklesForView = (prickles ?? []).map((p: any) => ({
    id: p.id,
    start_time: p.start_time,
    end_time: p.end_time,
    prickle_type: p.prickle_types?.name ?? "Unknown",
    attendance_count: attendedIds.has(p.id) ? 1 : 0,
    host: "",
    host_id: undefined,
    host_missing: false,
    host_late: false,
  }));

  const userTimezone = await getUserTimezonePreference();

  return (
    <div className="container mx-auto px-6 py-8">
      <div className="mb-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">My Attendance</h1>
            <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
              Week of {weekStart.toLocaleDateString()} — highlighted prickles
              are ones you attended
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Link
              href={`/calendar?week=${formatWeekParam(prevWeek)}`}
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
                href={`/calendar?week=${formatWeekParam(nextWeek)}`}
                className="px-3 py-2 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 transition-colors"
              >
                Next →
              </Link>
            )}
          </div>
        </div>
      </div>
      <CalendarScrollContainer scrollToHour={7}>
        <CalendarWeekView
          prickles={pricklesForView}
          weekStartDate={{
            year: weekStart.getFullYear(),
            month: weekStart.getMonth(),
            day: weekStart.getDate(),
          }}
          userTimezonePreference={userTimezone}
        />
      </CalendarScrollContainer>
    </div>
  );
}
