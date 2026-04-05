import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import CalendarWeekView from "./CalendarWeekView";

export default async function CalendarPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  // Get current week (Sunday to Saturday)
  const now = new Date();
  const dayOfWeek = now.getDay(); // 0 = Sunday
  const weekStart = new Date(now);
  weekStart.setDate(now.getDate() - dayOfWeek);
  weekStart.setHours(0, 0, 0, 0);

  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekStart.getDate() + 7);
  weekEnd.setHours(0, 0, 0, 0);

  // Fetch prickles for the current week with attendance counts
  const { data: prickles } = await supabase
    .from("prickles")
    .select(`
      id,
      title,
      host,
      start_time,
      end_time,
      type,
      attendance(id)
    `)
    .gte("start_time", weekStart.toISOString())
    .lt("start_time", weekEnd.toISOString())
    .order("start_time", { ascending: true });

  // Transform the data to include attendance count
  const pricklesWithCount = prickles?.map((prickle: any) => ({
    id: prickle.id,
    title: prickle.title,
    host: prickle.host,
    start_time: prickle.start_time,
    end_time: prickle.end_time,
    type: prickle.type,
    attendance_count: prickle.attendance?.length || 0,
  })) || [];

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
      <header className="border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
        <div className="container mx-auto px-6 py-4">
          <Link href="/dashboard" className="text-blue-600 hover:text-blue-700 dark:text-blue-400 text-sm mb-2 inline-block">
            ← Back to Dashboard
          </Link>
          <h1 className="text-2xl font-bold">Prickle Calendar</h1>
          <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
            Week of {weekStart.toLocaleDateString()} - Color intensity shows attendance levels
          </p>
        </div>
      </header>

      <main className="container mx-auto px-6 py-8">
        <CalendarWeekView prickles={pricklesWithCount} weekStart={weekStart} />
      </main>
    </div>
  );
}
