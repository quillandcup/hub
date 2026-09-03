import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { getEffectiveIdentity } from "@/lib/sudo";
import { getMonthStart, getNextMonthStart, isMonthLocked } from "@/lib/prickle-schedules";
import { getMySchedules, getMyHostingStats } from "./actions";
import HostingScheduleManager from "./HostingScheduleManager";
import HostingStats from "./HostingStats";

export const metadata: Metadata = {
  title: "Hosting",
};

export default async function HostingPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const effectiveIdentity = await getEffectiveIdentity(user);
  if (!effectiveIdentity) redirect("/admin");

  const now = new Date();
  const currentMonth = getMonthStart(now).toISOString().slice(0, 10);
  const nextMonth = getNextMonthStart(now).toISOString().slice(0, 10);

  const [{ data: prickleTypes }, schedules, { data: lockRows }, hostingStats] = await Promise.all([
    supabase.from("prickle_types").select("id, name").eq("requires_host", true).order("name"),
    getMySchedules(),
    supabase.from("prickle_schedule_locks").select("month, locked").in("month", [currentMonth, nextMonth]),
    getMyHostingStats(),
  ]);

  const overrides = (lockRows ?? []).map((r) => ({ month: r.month as string, locked: r.locked as boolean }));
  const currentMonthLocked = isMonthLocked(getMonthStart(now), overrides, now);
  const nextMonthLocked = isMonthLocked(getNextMonthStart(now), overrides, now);

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
      <header className="border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
        <div className="container mx-auto px-6 py-4">
          <h1 className="text-2xl font-bold">Hosting</h1>
          <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
            Manage the prickles you host, month by month.
          </p>
        </div>
      </header>

      <main className="container mx-auto px-6 py-8">
        <HostingStats stats={hostingStats} />
        <HostingScheduleManager
          initialSchedules={schedules}
          prickleTypes={prickleTypes ?? []}
          currentMonth={currentMonth}
          nextMonth={nextMonth}
          currentMonthLocked={currentMonthLocked}
          nextMonthLocked={nextMonthLocked}
        />
      </main>
    </div>
  );
}
