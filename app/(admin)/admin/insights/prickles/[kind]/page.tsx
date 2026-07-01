import { createClient } from "@/lib/supabase/server";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import {
  computeGroupedPrickleStats,
  type PrickleWithHost,
  type AttendanceRow,
  type GroupStats,
} from "@/lib/scheduled-prickle-stats";

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
// Sparkline SVG
// ---------------------------------------------------------------------------

function Sparkline({ values }: { values: number[] }) {
  if (values.length < 2) {
    return <span className="text-slate-400 text-sm">—</span>;
  }

  const W = 80;
  const H = 24;
  const PAD = 2;
  const minV = Math.min(...values);
  const maxV = Math.max(...values);
  const range = maxV - minV || 1;

  const points = values
    .map((v, i) => {
      const x = PAD + (i / (values.length - 1)) * (W - PAD * 2);
      const y = H - PAD - ((v - minV) / range) * (H - PAD * 2);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");

  return (
    <svg
      width={W}
      height={H}
      viewBox={`0 0 ${W} ${H}`}
      aria-hidden="true"
      className="inline-block text-blue-500 dark:text-blue-400"
    >
      <polyline
        points={points}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Stats table row
// ---------------------------------------------------------------------------

function StatsRow({ row }: { row: GroupStats }) {
  return (
    <tr className="hover:bg-slate-50 dark:hover:bg-slate-800">
      <td className="px-6 py-4 text-sm font-medium text-slate-900 dark:text-slate-100">
        {row.groupLabel}
      </td>
      <td className="px-6 py-4 text-right text-sm text-slate-900 dark:text-slate-100 tabular-nums">
        {row.sessions}
      </td>
      <td className="px-6 py-4 text-right text-sm text-slate-700 dark:text-slate-300 tabular-nums">
        {row.min}
      </td>
      <td className="px-6 py-4 text-right text-sm text-slate-700 dark:text-slate-300 tabular-nums">
        {row.median % 1 === 0 ? row.median : row.median.toFixed(1)}
      </td>
      <td className="px-6 py-4 text-right text-sm font-medium text-slate-900 dark:text-slate-100 tabular-nums">
        {row.mean.toFixed(1)}
      </td>
      <td className="px-6 py-4 text-right text-sm text-slate-700 dark:text-slate-300 tabular-nums">
        {row.max}
      </td>
      <td className="px-6 py-4">
        <Sparkline values={row.sparkline} />
      </td>
      <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-500 dark:text-slate-400">
        {new Date(row.lastSession).toLocaleDateString(undefined, {
          year: "numeric",
          month: "short",
          day: "numeric",
        })}
      </td>
    </tr>
  );
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

export default async function PrickleKindInsightsPage({
  params,
  searchParams,
}: {
  params: Promise<{ kind: string }>;
  searchParams: Promise<{ group?: string; from?: string; to?: string }>;
}) {
  const { kind } = await params;
  const { group, from, to } = await searchParams;

  const groupBy = group === "host" ? "host" : "schedule";

  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: prickleType } = await supabase
    .from("prickle_types")
    .select("id, name, normalized_name")
    .eq("normalized_name", kind)
    .single();

  if (!prickleType) notFound();

  const today = new Date().toISOString().split("T")[0];

  const prickles = await fetchPricklesForType(supabase, prickleType.id, from, to);
  const prickleIds = prickles.map((p) => p.id);
  const attendance = await fetchAttendanceForPrickles(supabase, prickleIds);

  const grouped = computeGroupedPrickleStats(prickles, attendance, groupBy);

  const presets = [
    { label: "All Time", from: undefined, to: undefined },
    { label: "Last 3 Months", from: dateOffsetISO(90), to: today },
    { label: "Last 6 Months", from: dateOffsetISO(180), to: today },
    { label: "Last Year", from: dateOffsetISO(365), to: today },
  ];

  const currentPreset = presets.find((p) => p.from === from && p.to === to)?.label;

  // Keep current range params when toggling group mode
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

        {/* Stats table */}
        <div className="bg-white dark:bg-slate-900 rounded-lg shadow">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-slate-50 dark:bg-slate-800">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                    {groupBy === "schedule" ? "Schedule Slot" : "Host"}
                  </th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                    Sessions
                  </th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                    Min
                  </th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                    Median
                  </th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                    Mean
                  </th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                    Max
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                    Trend (last 12)
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                    Last Session
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
                {grouped.map((row) => (
                  <StatsRow key={row.groupKey} row={row} />
                ))}
              </tbody>
            </table>
          </div>

          {grouped.length === 0 && (
            <div className="p-12 text-center text-slate-500 dark:text-slate-400">
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
          )}
        </div>

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
