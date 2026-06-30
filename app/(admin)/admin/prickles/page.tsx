import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import {
  computeScheduledPrickleStats,
  type PrickleType,
  type Prickle,
  type AttendanceRow,
} from "@/lib/scheduled-prickle-stats";

// ---------------------------------------------------------------------------
// Pagination helpers
// ---------------------------------------------------------------------------

async function fetchAllPrickles(
  supabase: Awaited<ReturnType<typeof createClient>>
): Promise<Prickle[]> {
  const BATCH = 1000;
  const rows: Prickle[] = [];
  let offset = 0;
  let hasMore = true;

  while (hasMore) {
    const { data } = await supabase
      .from("prickles")
      .select("id, type_id, start_time")
      .range(offset, offset + BATCH - 1)
      .order("start_time", { ascending: true });

    if (data && data.length > 0) {
      rows.push(...data);
      offset += data.length;
      hasMore = data.length === BATCH;
    } else {
      hasMore = false;
    }
  }

  return rows;
}

async function fetchAllAttendance(
  supabase: Awaited<ReturnType<typeof createClient>>
): Promise<AttendanceRow[]> {
  const BATCH = 1000;
  const rows: AttendanceRow[] = [];
  let offset = 0;
  let hasMore = true;

  while (hasMore) {
    const { data } = await supabase
      .from("prickle_attendance")
      .select("prickle_id, member_id")
      .range(offset, offset + BATCH - 1);

    if (data && data.length > 0) {
      rows.push(...data);
      offset += data.length;
      hasMore = data.length === BATCH;
    } else {
      hasMore = false;
    }
  }

  return rows;
}

// ---------------------------------------------------------------------------
// Sparkline SVG component
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
// Page
// ---------------------------------------------------------------------------

export default async function PricklesPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  // 1. Prickle types (small table — no pagination needed)
  const { data: typesRaw } = await supabase
    .from("prickle_types")
    .select("id, name")
    .order("name", { ascending: true });

  const types: PrickleType[] = typesRaw ?? [];

  // 2. All prickles (paginated — may exceed 1000 rows)
  const prickles = await fetchAllPrickles(supabase);

  // 3. All attendance (paginated — 10,000+ rows expected)
  const attendance = await fetchAllAttendance(supabase);

  // 4. Aggregate in memory
  const stats = computeScheduledPrickleStats(types, prickles, attendance);

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
      <header className="border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
        <div className="container mx-auto px-6 py-4">
          <Link
            href="/admin"
            className="text-blue-600 hover:text-blue-700 dark:text-blue-400 text-sm mb-2 inline-block"
          >
            ← Back to Dashboard
          </Link>
          <h1 className="text-2xl font-bold">Prickle Insights</h1>
        </div>
      </header>

      <main className="container mx-auto px-6 py-8">
        <div className="bg-white dark:bg-slate-900 rounded-lg shadow">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-slate-50 dark:bg-slate-800">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                    Name
                  </th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                    Sessions
                  </th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                    Min
                  </th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                    Mean
                  </th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                    Max
                  </th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                    Mode
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
                {stats.map((row) => (
                  <tr
                    key={row.typeId}
                    className="hover:bg-slate-50 dark:hover:bg-slate-800"
                  >
                    <td className="px-6 py-4">
                      <span className="text-sm font-medium text-slate-900 dark:text-slate-100">
                        {row.typeName}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-right text-sm text-slate-900 dark:text-slate-100 tabular-nums">
                      {row.sessions}
                    </td>
                    <td className="px-6 py-4 text-right text-sm text-slate-700 dark:text-slate-300 tabular-nums">
                      {row.min}
                    </td>
                    <td className="px-6 py-4 text-right text-sm font-medium text-slate-900 dark:text-slate-100 tabular-nums">
                      {row.mean.toFixed(1)}
                    </td>
                    <td className="px-6 py-4 text-right text-sm text-slate-700 dark:text-slate-300 tabular-nums">
                      {row.max}
                    </td>
                    <td className="px-6 py-4 text-right text-sm text-slate-700 dark:text-slate-300 tabular-nums">
                      {row.mode}
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
                ))}
              </tbody>
            </table>
          </div>

          {stats.length === 0 && (
            <div className="p-12 text-center text-slate-500 dark:text-slate-400">
              No prickle data found
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
