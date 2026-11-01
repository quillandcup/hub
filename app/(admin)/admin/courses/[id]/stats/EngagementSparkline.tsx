import type { HeatBucket } from "@/lib/courses/watch-stats";

/** A small engagement graph for a table row: the plays area only, no axes. The lesson's own page has the full chart. */
export default function EngagementSparkline({ buckets, label }: { buckets: HeatBucket[]; label: string }) {
  if (buckets.length === 0) return <span className="text-slate-500 dark:text-slate-400">No views</span>;
  const w = 120;
  const h = 28;
  const max = Math.max(...buckets.map((b) => b.timesWatched), 1);
  const x = (i: number) => (buckets.length === 1 ? w / 2 : (i / (buckets.length - 1)) * w);
  const y = (v: number) => h - 2 - (v / max) * (h - 4);
  const line = buckets.map((b, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(b.timesWatched).toFixed(1)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${w} ${h}`} role="img" aria-label={label} className="h-7 w-28">
      <path d={`${line} L${w},${h} L0,${h} Z`} className="fill-plum-600/15 dark:fill-plum-400/20" />
      <path d={line} fill="none" strokeWidth="1.5" strokeLinejoin="round" className="stroke-plum-600 dark:stroke-plum-400" />
    </svg>
  );
}
