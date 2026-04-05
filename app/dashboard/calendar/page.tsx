import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import CalendarWeekView from "./CalendarWeekView";

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ week?: string }>;
}) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

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

  // Fetch prickles for the current week with attendance counts
  const { data: prickles } = await supabase
    .from("prickles")
    .select(`
      id,
      host,
      start_time,
      end_time,
      prickle_types!inner(name),
      attendance(id)
    `)
    .gte("start_time", weekStart.toISOString())
    .lt("start_time", weekEnd.toISOString())
    .order("start_time", { ascending: true });

  // Transform the data to include attendance count
  const pricklesWithCount = prickles?.map((prickle: any) => ({
    id: prickle.id,
    host: prickle.host,
    start_time: prickle.start_time,
    end_time: prickle.end_time,
    prickle_type: prickle.prickle_types?.name || "Unknown",
    attendance_count: prickle.attendance?.length || 0,
  })) || [];

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
      <header className="border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
        <div className="container mx-auto px-6 py-4">
          <Link href="/dashboard" className="text-blue-600 hover:text-blue-700 dark:text-blue-400 text-sm mb-2 inline-block">
            ← Back to Dashboard
          </Link>
          <div className="flex items-center justify-between mt-2">
            <div>
              <h1 className="text-2xl font-bold">Prickle Calendar</h1>
              <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
                Week of {weekStart.toLocaleDateString()} - Color intensity shows attendance levels
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Link
                href={`/dashboard/calendar?week=${prevWeekParam}`}
                className="px-3 py-2 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg text-slate-700 dark:text-slate-300 transition-colors"
              >
                ← Previous
              </Link>
              <Link
                href={`/dashboard/calendar?week=${nextWeekParam}`}
                className={`px-3 py-2 rounded-lg transition-colors ${
                  isNextDisabled
                    ? "bg-slate-100 dark:bg-slate-800 text-slate-400 dark:text-slate-600 cursor-not-allowed"
                    : "bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300"
                }`}
                {...(isNextDisabled ? { "aria-disabled": true, onClick: (e: any) => e.preventDefault() } : {})}
              >
                Next →
              </Link>
            </div>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-6 py-8">
        <CalendarWeekView prickles={pricklesWithCount} weekStart={weekStart} />
      </main>
    </div>
  );
}
