"use client";

import { useState } from "react";
import type { HeatBucket } from "@/lib/courses/watch-stats";
import { formatClock } from "@/lib/courses/watch-stats";

const W = 720;
const H = 240;
const M = { left: 40, right: 64, top: 12, bottom: 28 };
const PLOT_W = W - M.left - M.right;
const PLOT_H = H - M.top - M.bottom;

/** A round number at or above `max`, so the top gridline is a clean value. */
function niceMax(max: number): number {
  if (max <= 1) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(max));
  const step = [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10].map((m) => m * magnitude).find((s) => s >= max) ?? max;
  return step;
}

const plays1 = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

/**
 * Wistia-style engagement graph for one video. The area is how many times each moment was played in
 * all, rewatches included; the dashed line is how many different people (members) played it, each
 * counted once however often. Where the area sits above the line, someone played that part more than
 * once: one person watching twice is 2 plays and 1 person. Hover (or arrow keys) reads a moment;
 * the table below has every value.
 */
export default function EngagementChart({ buckets, durationSeconds }: { buckets: HeatBucket[]; durationSeconds: number }) {
  const [active, setActive] = useState<number | null>(null);
  const n = buckets.length;
  if (n === 0) return <p className="text-sm text-slate-500 dark:text-slate-400">Nobody has watched this video yet.</p>;

  const top = niceMax(Math.max(...buckets.map((b) => Math.max(b.plays, b.viewers))));
  const x = (i: number) => M.left + (n === 1 ? PLOT_W / 2 : (i / (n - 1)) * PLOT_W);
  const y = (v: number) => M.top + PLOT_H - (v / top) * PLOT_H;
  const baseline = y(0);

  const playsLine = buckets.map((b, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(b.plays).toFixed(1)}`).join(" ");
  const playsArea = `${playsLine} L${x(n - 1).toFixed(1)},${baseline} L${x(0).toFixed(1)},${baseline} Z`;
  const viewersLine = buckets.map((b, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(b.viewers).toFixed(1)}`).join(" ");

  // Direct labels at the right end, nudged apart when the two ends are close.
  const last = buckets[n - 1];
  let playsLabelY = y(last.plays);
  let viewersLabelY = y(last.viewers);
  if (Math.abs(playsLabelY - viewersLabelY) < 14) {
    const mid = (playsLabelY + viewersLabelY) / 2;
    if (playsLabelY <= viewersLabelY) [playsLabelY, viewersLabelY] = [mid - 7, mid + 7];
    else [playsLabelY, viewersLabelY] = [mid + 7, mid - 7];
  }

  const yTicks = [0, top / 2, top];
  const xTicks = [0, 0.25, 0.5, 0.75, 1];
  const nearest = (clientX: number, rect: DOMRect) => {
    const px = ((clientX - rect.left) / rect.width) * W;
    return Math.max(0, Math.min(n - 1, Math.round(((px - M.left) / PLOT_W) * (n - 1))));
  };
  const onKeyDown = (e: React.KeyboardEvent) => {
    // From nothing selected, the first press lands on the nearest end.
    if (e.key === "ArrowRight") setActive(active === null ? 0 : Math.min(n - 1, active + 1));
    else if (e.key === "ArrowLeft") setActive(active === null ? n - 1 : Math.max(0, active - 1));
    else if (e.key === "Home") setActive(0);
    else if (e.key === "End") setActive(n - 1);
    else if (e.key === "Escape") setActive(null);
    else return;
    e.preventDefault();
  };

  const hovered = active === null ? null : buckets[active];
  const rewatching = hovered ? Math.max(0, hovered.plays - hovered.viewers) : 0;
  const tooltipOnRight = active !== null && x(active) < W * 0.6;

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-x-5 gap-y-1 text-sm text-slate-700 dark:text-slate-300">
        <span className="inline-flex items-center gap-2">
          <span aria-hidden="true" className="inline-block h-3 w-5 rounded-sm bg-plum-600/30 ring-1 ring-inset ring-plum-600 dark:bg-plum-400/30 dark:ring-plum-400" />
          Plays, rewatches included
        </span>
        <span className="inline-flex items-center gap-2">
          <svg aria-hidden="true" width="20" height="8" className="stroke-slate-500 dark:stroke-slate-400">
            <line x1="0" y1="4" x2="20" y2="4" strokeWidth="2" strokeDasharray="5 3" />
          </svg>
          People, each counted once
        </span>
      </div>

      <div className="relative">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          role="img"
          aria-label={`Engagement over the ${formatClock(durationSeconds)} video: plays and different viewers by moment. Arrow keys read each moment; the table below has every value.`}
          tabIndex={0}
          onKeyDown={onKeyDown}
          onBlur={() => setActive(null)}
          onPointerMove={(e) => setActive(nearest(e.clientX, e.currentTarget.getBoundingClientRect()))}
          onPointerLeave={() => setActive(null)}
          className="w-full touch-none rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-plum-500"
        >
          {yTicks.map((t) => (
            <g key={t}>
              <line x1={M.left} x2={W - M.right} y1={y(t)} y2={y(t)} strokeWidth="1" className="stroke-slate-200 dark:stroke-slate-800" />
              <text x={M.left - 6} y={y(t)} textAnchor="end" dominantBaseline="middle" className="fill-slate-500 text-[11px] dark:fill-slate-400">
                {plays1(t)}
              </text>
            </g>
          ))}
          {xTicks.map((f) => (
            <text key={f} x={M.left + f * PLOT_W} y={H - 8} textAnchor={f === 0 ? "start" : f === 1 ? "end" : "middle"} className="fill-slate-500 text-[11px] dark:fill-slate-400">
              {formatClock(f * durationSeconds)}
            </text>
          ))}

          <path d={playsArea} className="fill-plum-600/15 dark:fill-plum-400/20" />
          <path d={playsLine} fill="none" strokeWidth="2" strokeLinejoin="round" className="stroke-plum-600 dark:stroke-plum-400" />
          <path d={viewersLine} fill="none" strokeWidth="2" strokeDasharray="5 3" strokeLinejoin="round" className="stroke-slate-500 dark:stroke-slate-400" />

          <text x={W - M.right + 6} y={playsLabelY} dominantBaseline="middle" className="fill-slate-700 text-[11px] dark:fill-slate-300">
            Plays
          </text>
          <text x={W - M.right + 6} y={viewersLabelY} dominantBaseline="middle" className="fill-slate-700 text-[11px] dark:fill-slate-300">
            People
          </text>

          {active !== null && hovered && (
            <g pointerEvents="none">
              <line x1={x(active)} x2={x(active)} y1={M.top} y2={baseline} strokeWidth="1" className="stroke-slate-400 dark:stroke-slate-500" />
              <circle cx={x(active)} cy={y(hovered.plays)} r="4" strokeWidth="2" className="fill-plum-600 stroke-white dark:fill-plum-400 dark:stroke-slate-900" />
              <circle cx={x(active)} cy={y(hovered.viewers)} r="4" strokeWidth="2" className="fill-slate-500 stroke-white dark:fill-slate-400 dark:stroke-slate-900" />
            </g>
          )}
        </svg>

        {hovered && active !== null && (
          <div
            role="status"
            className="pointer-events-none absolute top-2 z-10 w-44 rounded-md border border-slate-200 bg-white p-2 text-xs shadow-md dark:border-slate-700 dark:bg-slate-900"
            style={tooltipOnRight ? { left: `${(x(active) / W) * 100 + 2}%` } : { right: `${100 - (x(active) / W) * 100 + 2}%` }}
          >
            <p className="text-slate-500 dark:text-slate-400">
              {formatClock(hovered.start)} to {formatClock(hovered.end)}
            </p>
            <p className="mt-1 flex items-center justify-between gap-2">
              <span className="inline-flex items-center gap-1.5 text-slate-600 dark:text-slate-400">
                <span aria-hidden="true" className="inline-block h-0.5 w-3 bg-plum-600 dark:bg-plum-400" />
                Plays
              </span>
              <strong className="text-slate-900 dark:text-slate-100">{plays1(hovered.plays)}</strong>
            </p>
            <p className="flex items-center justify-between gap-2">
              <span className="inline-flex items-center gap-1.5 text-slate-600 dark:text-slate-400">
                <span aria-hidden="true" className="inline-block h-0.5 w-3 bg-slate-500 dark:bg-slate-400" />
                People
              </span>
              <strong className="text-slate-900 dark:text-slate-100">{hovered.viewers}</strong>
            </p>
            {rewatching >= 0.05 && (
              <p className="mt-1 border-t border-slate-100 pt-1 text-slate-600 dark:border-slate-800 dark:text-slate-400">
                Rewatched: <strong className="text-slate-900 dark:text-slate-100">{plays1(Math.round(rewatching * 10) / 10)}</strong>
              </p>
            )}
          </div>
        )}
      </div>

      <details className="mt-3 text-sm">
        <summary className="cursor-pointer text-plum-700 dark:text-plum-300">Table view</summary>
        <div className="mt-2 max-h-64 overflow-y-auto">
          <table className="w-full text-left text-xs">
            <thead className="sticky top-0 bg-white text-slate-500 dark:bg-slate-900 dark:text-slate-400">
              <tr>
                <th className="py-1 pr-3 font-medium">Moment</th>
                <th className="py-1 pr-3 text-right font-medium">Plays</th>
                <th className="py-1 pr-3 text-right font-medium">People</th>
                <th className="py-1 text-right font-medium">Rewatched</th>
              </tr>
            </thead>
            <tbody>
              {buckets.map((b) => (
                <tr key={b.start} className="border-t border-slate-100 dark:border-slate-800">
                  <td className="py-1 pr-3">
                    {formatClock(b.start)} to {formatClock(b.end)}
                  </td>
                  <td className="py-1 pr-3 text-right tabular-nums">{plays1(b.plays)}</td>
                  <td className="py-1 pr-3 text-right tabular-nums">{b.viewers}</td>
                  <td className="py-1 text-right tabular-nums">{plays1(Math.max(0, Math.round((b.plays - b.viewers) * 10) / 10))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
