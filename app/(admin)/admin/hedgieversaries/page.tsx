import type { Metadata } from "next";
import { getMemberDisplayName } from "@/lib/member-display-name";
import { createClient } from "@/lib/supabase/server";
import { createRepos } from "@/lib/data/repos";
import { getCurrentUser } from "@/lib/auth";
import { redirect } from "next/navigation";
import { getUserFeaturePreviews } from "@/lib/features.server";
import {
  computeCumulativeHiatusMonths,
  computeCumulativeInactiveMonths,
  isCurrentlyOnHiatus,
  nextHedgieversaryDate,
  type HiatusWindow,
} from "@/lib/member-tenure";
import HedgieversariesTable, { type HedgieversaryRow } from "./HedgieversariesTable";
import { requireAdminPage } from "@/lib/admin-auth";

export const metadata: Metadata = {
  title: "Hedgieversaries",
};

export default async function HedgieversariesPage() {
  await requireAdminPage();
  const supabase = await createClient();

  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const enabledFeatures = await getUserFeaturePreviews(user.id);
  if (!enabledFeatures.includes("hedgieversaries")) redirect("/admin");

  // Only current members (active or on_hiatus) with a real first join date —
  // cancelled former members and leads don't get a Hedgieversary to
  // celebrate here.
  // (members and member_status_overrides can each grow past Supabase's 1000-row cap: both are paginated.)
  const repos = createRepos(supabase);
  const [members, hiatusHistory] = await Promise.all([repos.members.tenureOf(["active", "on_hiatus"]).then((rows) => rows.filter((m) => m.firstJoinedAt !== null)), repos.memberStatus.allHiatuses()]);

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
    const cumulativeInactiveMonths = computeCumulativeInactiveMonths(
      m.firstJoinedAt!,
      m.totalActiveMonths,
      cumulativeHiatusMonths,
      now
    );
    const { nextDate, milestoneMonths, recentDate, recentMilestoneMonths } = nextHedgieversaryDate(
      m.firstJoinedAt!,
      cumulativeInactiveMonths,
      isCurrentlyOnHiatus(windows, now),
      now
    );

    return {
      id: m.id,
      name: getMemberDisplayName({ name: m.name, display_name: m.displayName }),
      legalName: m.name,
      email: m.email,
      firstJoinedAt: m.firstJoinedAt!,
      mostRecentJoinedAt: m.mostRecentJoinedAt,
      totalActiveMonths: m.totalActiveMonths,
      nextDate,
      milestoneMonths,
      recentDate,
      recentMilestoneMonths,
      cumulativeHiatusMonths,
      hiatusWindows: windows,
    };
  });

  return (
    <div className="min-h-screen bg-canvas dark:bg-slate-950">
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
