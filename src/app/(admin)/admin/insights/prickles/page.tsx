import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { createRepos } from "@/lib/data/repos";
import { getCurrentUser } from "@/lib/auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import {
  computeScheduledPrickleStats,
  pricklesWindowEnd,
  type PrickleType,
  type Prickle,
  type AttendanceRow,
} from "@/lib/scheduled-prickle-stats";
import PricklesTable from "./PricklesTable";
import { requireAdminPage } from "@/lib/admin-auth";

export const metadata: Metadata = {
  title: "Prickle Insights",
};

// ---------------------------------------------------------------------------
// Pagination helpers
// ---------------------------------------------------------------------------

async function fetchAllPrickles(
  supabase: Awaited<ReturnType<typeof createClient>>,
  from?: string,
  to?: string
): Promise<Prickle[]> {
  const found = await createRepos(supabase).prickles.startingBetween({
    from: from ?? new Date(0).toISOString(),
    to: pricklesWindowEnd(to, new Date()),
    inclusiveEnd: true,
  });
  return found.map((p) => ({ id: p.id, type_id: p.typeId, start_time: p.startTime }));
}

async function fetchAllAttendance(
  supabase: Awaited<ReturnType<typeof createClient>>
): Promise<AttendanceRow[]> {
  const links = await createRepos(supabase).attendance.list();
  return links.map((l) => ({ prickle_id: l.prickleId, member_id: l.memberId }));
}

// ---------------------------------------------------------------------------
// Time range helpers
// ---------------------------------------------------------------------------

function dateOffsetISO(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().split("T")[0];
}

function buildRangeUrl(from?: string, to?: string): string {
  const params = new URLSearchParams();
  if (from) params.set("from", from);
  if (to) params.set("to", to);
  const qs = params.toString();
  return qs ? `?${qs}` : "?";
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default async function PrickleInsightsPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  await requireAdminPage();
  const supabase = await createClient();

  const user = await getCurrentUser();

  if (!user) {
    redirect("/login");
  }

  const { from, to } = await searchParams;

  const today = new Date().toISOString().split("T")[0];

  const types: PrickleType[] = (await createRepos(supabase).prickles.types()).filter((t) => t.normalizedName !== "event").map((t) => ({
    id: t.id,
    name: t.name,
    normalized_name: t.normalizedName,
  }));

  // All prickles in range (paginated)
  const prickles = await fetchAllPrickles(supabase, from, to);

  // All attendance (paginated — attendance is per-prickle, filter in memory)
  const attendance = await fetchAllAttendance(supabase);

  const stats = computeScheduledPrickleStats(types, prickles, attendance);

  const presets = [
    { label: "All Time", from: undefined, to: undefined },
    { label: "Last 3 Months", from: dateOffsetISO(90), to: today },
    { label: "Last 6 Months", from: dateOffsetISO(180), to: today },
    { label: "Last Year", from: dateOffsetISO(365), to: today },
  ];

  const currentPreset = presets.find(
    (p) => p.from === from && p.to === to
  )?.label;

  return (
    <div className="min-h-screen bg-canvas dark:bg-slate-950">
      <header className="border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
        <div className="container mx-auto px-6 py-4">
          <Link
            href="/admin"
            className="text-plum-600 hover:text-plum-700 dark:text-plum-400 text-sm mb-2 inline-block"
          >
            ← Back to Dashboard
          </Link>
          <h1 className="text-2xl font-bold">Prickle Insights</h1>
        </div>
      </header>

      <main className="container mx-auto px-6 py-8 space-y-6">
        {/* Time range filter */}
        <div className="bg-white dark:bg-slate-900 rounded-lg shadow px-6 py-4">
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-sm font-medium text-slate-600 dark:text-slate-400">
              Period:
            </span>
            <div className="flex gap-2">
              {presets.map((preset) => {
                const url = buildRangeUrl(preset.from, preset.to);
                const isActive = preset.label === (currentPreset ?? "All Time");
                return (
                  <Link
                    key={preset.label}
                    href={url}
                    className={`px-3 py-1 rounded-full text-sm transition-colors ${
                      isActive
                        ? "bg-plum-600 text-white"
                        : "bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700"
                    }`}
                  >
                    {preset.label}
                  </Link>
                );
              })}
            </div>
            <form method="GET" className="flex items-center gap-2 text-sm">
              <input
                type="date"
                name="from"
                defaultValue={from ?? ""}
                max={today}
                className="border border-slate-300 dark:border-slate-600 rounded px-2 py-1 text-sm bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100"
              />
              <span className="text-slate-600 dark:text-slate-400">to</span>
              <input
                type="date"
                name="to"
                defaultValue={to ?? ""}
                max={today}
                className="border border-slate-300 dark:border-slate-600 rounded px-2 py-1 text-sm bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100"
              />
              <button
                type="submit"
                className="px-3 py-1 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded text-sm text-slate-700 dark:text-slate-300 transition-colors"
              >
                Apply
              </button>
            </form>
          </div>
        </div>

        {stats.length === 0 ? (
          <div className="bg-white dark:bg-slate-900 rounded-lg shadow p-12 text-center text-slate-600 dark:text-slate-400">
            No prickle data found
            {(from || to) && (
              <span>
                {" "}
                for this period.{" "}
                <Link href="?" className="text-plum-600 hover:underline">
                  View all time
                </Link>
              </span>
            )}
          </div>
        ) : (
          <PricklesTable rows={stats} from={from} to={to} />
        )}
      </main>
    </div>
  );
}
