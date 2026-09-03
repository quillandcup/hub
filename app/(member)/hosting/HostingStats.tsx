import type { HostingStats as HostingStatsData } from "@/lib/hosting-stats";

function formatShortDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

function Sparkline({ values }: { values: number[] }) {
  if (values.every((v) => v === 0)) {
    return <span className="text-slate-400 text-sm">No hosting activity in the last 12 months</span>;
  }
  const W = 200;
  const H = 40;
  const PAD = 3;
  const maxV = Math.max(...values, 1);
  const barWidth = (W - PAD * 2) / values.length;
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} aria-hidden="true" className="text-blue-500 dark:text-blue-400">
      {values.map((v, i) => {
        const barHeight = (v / maxV) * (H - PAD * 2);
        const x = PAD + i * barWidth;
        const y = H - PAD - barHeight;
        return (
          <rect
            key={i}
            x={x + 0.5}
            y={y}
            width={Math.max(barWidth - 1, 1)}
            height={Math.max(barHeight, v > 0 ? 1 : 0)}
            fill="currentColor"
            rx={1}
          />
        );
      })}
    </svg>
  );
}

function StatTile({ value, label, muted }: { value: string; label: string; muted?: boolean }) {
  return (
    <div className="text-center">
      <p className={`text-3xl font-bold ${muted ? "text-slate-400 dark:text-slate-500" : ""}`}>{value}</p>
      <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{label}</p>
    </div>
  );
}

export default function HostingStats({ stats }: { stats: HostingStatsData }) {
  const { totalHosted, onTimeCount, lateCount, missingCount, onTimeRate, mostRecentHostedAt, monthlyTrend, byType } =
    stats;

  return (
    <div className="bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800 p-4 sm:p-6 mb-6">
      <h2 className="text-sm font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-4">
        Your Hosting Stats
      </h2>

      {totalHosted === 0 ? (
        <p className="text-sm text-slate-500 dark:text-slate-400">
          You haven&apos;t hosted a Prickle yet. Once you do, your hosting history and stats will show up here.
        </p>
      ) : (
        <>
          <div className="flex items-center gap-6 sm:gap-8 flex-wrap">
            <StatTile value={String(totalHosted)} label={totalHosted === 1 ? "prickle hosted" : "prickles hosted"} />
            <StatTile
              value={onTimeRate === null ? "—" : `${Math.round(onTimeRate * 100)}%`}
              label="on-time rate"
            />
            {mostRecentHostedAt && (
              <StatTile value={formatShortDate(mostRecentHostedAt)} label="most recent" muted />
            )}
          </div>

          {/* Collapsed by default -- the breakdown/trend/type sections below eat a lot of
              vertical space on mobile and push the operational schedule manager below the
              fold, so they're opt-in via disclosure rather than always rendered open. */}
          <details className="mt-4 pt-4 border-t border-slate-100 dark:border-slate-800">
            <summary className="text-xs text-slate-400 cursor-pointer select-none hover:text-slate-600 dark:hover:text-slate-300 w-fit">
              More stats
            </summary>

            <div className="flex items-center gap-4 mt-4 text-sm flex-wrap">
              <span className="text-slate-600 dark:text-slate-300">
                <span className="font-semibold">{onTimeCount}</span> on time
              </span>
              <span className="text-slate-300 dark:text-slate-700">·</span>
              <span className="text-slate-600 dark:text-slate-300">
                <span className="font-semibold">{lateCount}</span> {lateCount === 1 ? "was" : "were"} late (&gt;5 min)
              </span>
              <span className="text-slate-300 dark:text-slate-700">·</span>
              <span className="text-slate-600 dark:text-slate-300">
                <span className="font-semibold">{missingCount}</span> no-show
              </span>
            </div>

            <div className="mt-4 pt-4 border-t border-slate-100 dark:border-slate-800">
              <p className="text-xs text-slate-400 dark:text-slate-500 mb-2">Hosted per month, last 12 months</p>
              <Sparkline values={monthlyTrend} />
            </div>

            {byType.length > 1 && (
              <div className="mt-4 pt-4 border-t border-slate-100 dark:border-slate-800">
                <p className="text-xs text-slate-400 dark:text-slate-500 mb-2">By prickle type</p>
                <div className="flex flex-wrap gap-1.5">
                  {byType.map((t) => (
                    <span
                      key={t.typeName}
                      className="text-xs bg-slate-100 dark:bg-slate-800 rounded px-2 py-0.5 text-slate-600 dark:text-slate-300"
                    >
                      {t.typeName} · {t.count}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </details>
        </>
      )}
    </div>
  );
}
