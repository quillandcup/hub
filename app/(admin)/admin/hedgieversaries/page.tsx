import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { getUserFeaturePreviews } from "@/lib/features.server";
import { computeCumulativeHiatusMonths, nextHedgieversaryDate, type HiatusWindow } from "@/lib/member-tenure";
import HedgieversariesTable, { type HedgieversaryRow } from "./HedgieversariesTable";
import type { SupabaseClient } from "@supabase/supabase-js";

export const metadata: Metadata = {
  title: "Hedgieversaries",
};

// Same pagination pattern as app/api/process/members/route.ts — members and
// member_status_overrides can each grow past Supabase's 1000-row cap.
async function fetchAllRows(
  supabase: SupabaseClient,
  table: string,
  columns: string,
  filter?: (query: any) => any
): Promise<any[]> {
  const BATCH_SIZE = 1000;
  let allRows: any[] = [];
  let offset = 0;
  let hasMore = true;

  while (hasMore) {
    let query = supabase.from(table).select(columns);
    if (filter) query = filter(query);
    const { data: batch, error } = await query.range(offset, offset + BATCH_SIZE - 1);
    if (error) throw error;

    if (batch && batch.length > 0) {
      allRows = allRows.concat(batch);
      offset += batch.length;
      hasMore = batch.length === BATCH_SIZE;
    } else {
      hasMore = false;
    }
  }

  return allRows;
}

export default async function HedgieversariesPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const enabledFeatures = await getUserFeaturePreviews(user.id);
  if (!enabledFeatures.includes("hedgieversaries")) redirect("/admin");

  // Only current members (active or on_hiatus) with a real first join date —
  // cancelled former members and leads don't get a Hedgieversary to
  // celebrate here.
  const [members, hiatusHistory] = await Promise.all([
    fetchAllRows(
      supabase,
      "members",
      "id, name, email, status, first_joined_at, most_recent_joined_at, total_active_months",
      (q) => q.in("status", ["active", "on_hiatus"]).not("first_joined_at", "is", null)
    ),
    fetchAllRows(supabase, "member_hiatus_history", "member_id, start_date, end_date"),
  ]);

  const now = new Date();

  const hiatusWindowsByMember = new Map<string, HiatusWindow[]>();
  for (const hiatus of hiatusHistory) {
    const windows = hiatusWindowsByMember.get(hiatus.member_id) ?? [];
    windows.push({ startsAt: hiatus.start_date, endsAt: hiatus.end_date });
    hiatusWindowsByMember.set(hiatus.member_id, windows);
  }

  const rows: HedgieversaryRow[] = members.map((m) => {
    const windows = hiatusWindowsByMember.get(m.id) ?? [];
    const cumulativeHiatusMonths = computeCumulativeHiatusMonths(windows, now);
    const isOnIndefiniteHiatus = windows.some(
      (w) => !w.endsAt && new Date(w.startsAt).getTime() <= now.getTime()
    );
    const { nextDate, milestoneMonths, recentDate, recentMilestoneMonths } = nextHedgieversaryDate(
      m.first_joined_at,
      cumulativeHiatusMonths,
      isOnIndefiniteHiatus,
      now
    );

    return {
      id: m.id,
      name: m.name,
      email: m.email,
      firstJoinedAt: m.first_joined_at,
      mostRecentJoinedAt: m.most_recent_joined_at,
      totalActiveMonths: m.total_active_months ?? 0,
      nextDate,
      milestoneMonths,
      recentDate,
      recentMilestoneMonths,
      cumulativeHiatusMonths,
      hiatusWindows: windows,
    };
  });

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
      <header className="border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
        <div className="container mx-auto px-6 py-4">
          <h1 className="text-2xl font-bold">Hedgieversaries</h1>
          <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
            First-joined date, most recent rejoin, active months, and the next milestone date —
            replaces the manual spreadsheet.
          </p>
        </div>
      </header>

      <main className="container mx-auto px-6 py-8">
        <div className="bg-white dark:bg-slate-900 rounded-lg shadow">
          <HedgieversariesTable rows={rows} asOf={now.toISOString()} />
        </div>
      </main>
    </div>
  );
}
