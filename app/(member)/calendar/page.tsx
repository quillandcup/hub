import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import CalendarWeekView from "@/components/CalendarWeekView";
import CalendarScrollContainer from "@/components/CalendarScrollContainer";
import { getUserTimezonePreference } from "@/lib/timezone";
import { getEffectiveIdentity } from "@/lib/sudo";
import { buildMemberPrickleViews } from "@/lib/calendar/member-prickle-views";

export default async function MemberCalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ week?: string }>;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const effectiveIdentity = await getEffectiveIdentity(user);
  if (!effectiveIdentity) return null;

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
    .eq("member_id", effectiveIdentity.memberId)
    .gte("join_time", weekStart.toISOString())
    .lt("join_time", weekEnd.toISOString());

  const attendedIds = new Set(attended?.map((a) => a.prickle_id) ?? []);

  // Fetch distinct member count per attended prickle
  // prickle_attendance allows multiple rows per (member_id, prickle_id) for leave/rejoin,
  // so we count distinct member_ids in memory.
  const attendedPrickleIds = [...attendedIds];
  let countByPrickle = new Map<string, number>();

  if (attendedPrickleIds.length > 0) {
    const { data: countRows, error: countError } = await supabase
      .from("prickle_attendance")
      .select("prickle_id, member_id")
      .in("prickle_id", attendedPrickleIds)
      .gte("join_time", weekStart.toISOString())
      .lt("join_time", weekEnd.toISOString());

    if (countError) throw countError;

    const memberSets = new Map<string, Set<string>>();
    countRows?.forEach(({ prickle_id, member_id }) => {
      if (!memberSets.has(prickle_id)) memberSets.set(prickle_id, new Set());
      memberSets.get(prickle_id)!.add(member_id);
    });
    countByPrickle = new Map(
      [...memberSets.entries()].map(([id, members]) => [id, members.size])
    );
  }

  // Shape data to match CalendarWeekView Prickle interface, filtered to attended prickles.
  type RawPrickle = { id: string; start_time: string; end_time: string; prickle_types: { name: string } | null };
  const pricklesForView = buildMemberPrickleViews(
    (prickles ?? []) as unknown as RawPrickle[],
    attendedIds,
    countByPrickle
  );

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
          mode="member"
        />
      </CalendarScrollContainer>
    </div>
  );
}
