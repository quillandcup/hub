import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import {
  computeGroupedPrickleStats,
  type PrickleWithHost,
  type AttendanceRow,
} from "@/lib/scheduled-prickle-stats";
import GroupedTable from "./GroupedTable";

// ---------------------------------------------------------------------------
// Pagination helpers
// ---------------------------------------------------------------------------

async function fetchPricklesForType(
  supabase: Awaited<ReturnType<typeof createClient>>,
  typeId: string,
  from?: string,
  to?: string
): Promise<PrickleWithHost[]> {
  const BATCH = 1000;
  const rows: PrickleWithHost[] = [];
  let offset = 0;
  let hasMore = true;
  const now = new Date().toISOString();

  while (hasMore) {
    let query = supabase
      .from("prickles")
      .select("id, type_id, start_time, host:members(id, name)")
      .eq("type_id", typeId)
      .lte("start_time", now)
      .range(offset, offset + BATCH - 1)
      .order("start_time", { ascending: true });

    if (from) query = query.gte("start_time", from);
    if (to) query = query.lte("start_time", to + "T23:59:59Z");

    const { data } = await query;

    if (data && data.length > 0) {
      rows.push(...(data as unknown as PrickleWithHost[]));
      offset += data.length;
      hasMore = data.length === BATCH;
    } else {
      hasMore = false;
    }
  }

  return rows;
}

async function fetchAttendanceForPrickles(
  supabase: Awaited<ReturnType<typeof createClient>>,
  prickleIds: string[]
): Promise<AttendanceRow[]> {
  if (prickleIds.length === 0) return [];

  const BATCH_IDS = 500;
  const rows: AttendanceRow[] = [];

  for (let i = 0; i < prickleIds.length; i += BATCH_IDS) {
    const chunk = prickleIds.slice(i, i + BATCH_IDS);
    const PAGE = 1000;
    let offset = 0;
    let hasMore = true;

    while (hasMore) {
      const { data } = await supabase
        .from("prickle_attendance")
        .select("prickle_id, member_id")
        .in("prickle_id", chunk)
        .range(offset, offset + PAGE - 1);

      if (data && data.length > 0) {
        rows.push(...data);
        offset += data.length;
        hasMore = data.length === PAGE;
      } else {
        hasMore = false;
      }
    }
  }

  return rows;
}

// ---------------------------------------------------------------------------
// URL helpers
// ---------------------------------------------------------------------------

function buildUrl(params: Record<string, string | undefined>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined) sp.set(k, v);
  }
  const qs = sp.toString();
  return qs ? `?${qs}` : "?";
}

function dateOffsetISO(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().split("T")[0];
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

const getPrickleType = cache(async (kind: string) => {
  const supabase = await createClient();
  const { data } = await supabase
    .from("prickle_types")
    .select("id, name, normalized_name")
    .eq("normalized_name", kind)
    .single();
  return data;
});

export async function generateMetadata({
  params,
}: {
  params: Promise<{ kind: string }>;
}): Promise<Metadata> {
  const { kind } = await params;
  const prickleType = await getPrickleType(kind);
  return { title: prickleType?.name ?? "Prickle Insights" };
}

export default async function PrickleKindInsightsPage({
  params,
  searchParams,
}: {
  params: Promise<{ kind: string }>;
  searchParams: Promise<{ group?: string; from?: string; to?: string; slot?: string }>;
}) {
  const { kind } = await params;
  const { group, from, to, slot } = await searchParams;

  const groupBy = group === "host" ? "host" : "schedule";

  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const prickleType = await getPrickleType(kind);

  if (!prickleType) notFound();

  const today = new Date().toISOString().split("T")[0];

  const [prickles, membersRaw] = await Promise.all([
    fetchPricklesForType(supabase, prickleType.id, from, to),
    supabase.from("members").select("id, name"),
  ]);

  const memberNameMap = new Map<string, string>(
    (membersRaw.data ?? []).map((m) => [m.id, m.name])
  );

  const prickleIds = prickles.map((p) => p.id);
  const attendance = await fetchAttendanceForPrickles(supabase, prickleIds);

  const grouped = computeGroupedPrickleStats(prickles, attendance, groupBy, memberNameMap);

  const presets = [
    { label: "All Time", from: undefined, to: undefined },
    { label: "Last 3 Months", from: dateOffsetISO(90), to: today },
    { label: "Last 6 Months", from: dateOffsetISO(180), to: today },
    { label: "Last Year", from: dateOffsetISO(365), to: today },
  ];

  const currentPreset = presets.find((p) => p.from === from && p.to === to)?.label;

  const rangeParams = { from, to };
  const scheduleUrl = buildUrl({ ...rangeParams, group: "schedule" });
  const hostUrl = buildUrl({ ...rangeParams, group: "host" });

  const backUrl = `/admin/insights/prickles${buildUrl({ from, to })}`;

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
      <header className="border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
        <div className="container mx-auto px-6 py-4">
          <Link
            href={backUrl}
            className="text-blue-600 hover:text-blue-700 dark:text-blue-400 text-sm mb-2 inline-block"
          >
            ← Back to Prickle Insights
          </Link>
          <h1 className="text-2xl font-bold">{prickleType.name}</h1>
        </div>
      </header>

      <main className="container mx-auto px-6 py-8 space-y-6">
        {/* Controls row */}
        <div className="bg-white dark:bg-slate-900 rounded-lg shadow px-6 py-4 space-y-4">
          {/* Time range filter */}
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-sm font-medium text-slate-600 dark:text-slate-400">
              Period:
            </span>
            <div className="flex gap-2">
              {presets.map((preset) => {
                const url = buildUrl({
                  group: groupBy,
                  from: preset.from,
                  to: preset.to,
                });
                const isActive = preset.label === (currentPreset ?? "All Time");
                return (
                  <Link
                    key={preset.label}
                    href={url}
                    className={`px-3 py-1 rounded-full text-sm transition-colors ${
                      isActive
                        ? "bg-blue-600 text-white"
                        : "bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700"
                    }`}
                  >
                    {preset.label}
                  </Link>
                );
              })}
            </div>
            <form method="GET" className="flex items-center gap-2 text-sm">
              <input type="hidden" name="group" value={groupBy} />
              <input
                type="date"
                name="from"
                defaultValue={from ?? ""}
                max={today}
                className="border border-slate-300 dark:border-slate-600 rounded px-2 py-1 text-sm bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100"
              />
              <span className="text-slate-500">to</span>
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

          {/* Group by toggle */}
          <div className="flex items-center gap-3">
            <span className="text-sm font-medium text-slate-600 dark:text-slate-400">
              Group by:
            </span>
            <div className="flex gap-2">
              <Link
                href={scheduleUrl}
                className={`px-3 py-1 rounded-full text-sm transition-colors ${
                  groupBy === "schedule"
                    ? "bg-blue-600 text-white"
                    : "bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700"
                }`}
              >
                Scheduled Day
              </Link>
              <Link
                href={hostUrl}
                className={`px-3 py-1 rounded-full text-sm transition-colors ${
                  groupBy === "host"
                    ? "bg-blue-600 text-white"
                    : "bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700"
                }`}
              >
                Host
              </Link>
            </div>
            {groupBy === "host" && (
              <span className="text-xs text-slate-400 dark:text-slate-500">
                Note: uses first listed host from calendar; multi-host sessions are a TODO
              </span>
            )}
          </div>
        </div>

        {grouped.length === 0 ? (
          <div className="bg-white dark:bg-slate-900 rounded-lg shadow p-12 text-center text-slate-500 dark:text-slate-400">
            No sessions found
            {(from || to) && (
              <span>
                {" "}
                for this period.{" "}
                <Link
                  href={buildUrl({ group: groupBy })}
                  className="text-blue-600 hover:underline"
                >
                  View all time
                </Link>
              </span>
            )}
          </div>
        ) : (
          <GroupedTable rows={grouped} groupBy={groupBy} defaultExpanded={slot} />
        )}

        {prickles.length > 0 && (
          <p className="text-xs text-slate-400 dark:text-slate-500 text-right">
            {prickles.length} session{prickles.length !== 1 ? "s" : ""} •{" "}
            {attendance.length} attendance record{attendance.length !== 1 ? "s" : ""}
          </p>
        )}
      </main>
    </div>
  );
}
