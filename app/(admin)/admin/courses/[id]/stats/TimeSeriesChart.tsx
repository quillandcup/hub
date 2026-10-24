"use client";

import { useState } from "react";
import { formatMetricValue, type SeriesPoint, type Unit } from "@/lib/courses/watch-timeseries";

const W = 720;
const H = 240;
const M = { left: 48, right: 16, top: 12, bottom: 28 };
const PLOT_W = W - M.left - M.right;
const PLOT_H = H - M.top - M.bottom;
const DOTS_UNTIL = 60;

/** A round number at or above `max`, so the top gridline is a clean value. */
function niceMax(max: number): number {
  if (max <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(max));
  return [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10].map((m) => m * magnitude).find((s) => s >= max) ?? max;
}

const tick = (value: number, unit: Unit) => formatMetricValue(value, unit);

/**
 * One metric over time (Kajabi's Analytics chart): a line over a light area, with every day, week or
 * month in the range as a point. Hover or the arrow keys read a point, and the tooltip also gives the
 * counts behind it; the table below has every value. Percent values are 0 to 1.
 */
export default function TimeSeriesChart({
  points,
  unit,
  metricLabel,
  granularityLabel,
}: {
  points: SeriesPoint[];
  unit: Unit;
  metricLabel: string;
  /** "day", "week" or "month", for the table and the readout. */
  granularityLabel: string;
}) {
  const [active, setActive] = useState<number | null>(null);
  const n = points.length;
  if (n === 0) return <p className="text-sm text-slate-600 dark:text-slate-400">Nothing in this range.</p>;

  const peak = Math.max(...points.map((p) => p.value));
  // Percent charts always read from 0 to a round value of at least 10%, so a quiet range doesn't look dramatic.
  // Counts are whole numbers: the top is one too, and the middle gridline is dropped when it would be a fraction.
  const top = unit === "count" ? Math.max(1, Math.ceil(niceMax(peak))) : niceMax(unit === "percent" ? Math.max(peak, 0.1) : peak);
  const x = (i: number) => M.left + (n === 1 ? PLOT_W / 2 : (i / (n - 1)) * PLOT_W);
  const y = (v: number) => M.top + PLOT_H - (v / top) * PLOT_H;
  const baseline = y(0);

  const line = points.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(" ");
  const area = `${line} L${x(n - 1).toFixed(1)},${baseline} L${x(0).toFixed(1)},${baseline} Z`;

  const yTicks = unit === "count" && top % 2 !== 0 ? [0, top] : [0, top / 2, top];
  // About six labels along the bottom, always ending on the last point (it replaces a label that would crowd it).
  const labelEvery = Math.max(1, Math.ceil(n / 6));
  const labelled: number[] = [];
  for (let i = 0; i < n; i += labelEvery) labelled.push(i);
  if (labelled[labelled.length - 1] !== n - 1) {
    if (n - 1 - labelled[labelled.length - 1] >= labelEvery / 2) labelled.push(n - 1);
    else labelled[labelled.length - 1] = n - 1;
  }

  const nearest = (clientX: number, rect: RectLike) => {
    const px = ((clientX - rect.left) / rect.width) * W;
    return Math.max(0, Math.min(n - 1, Math.round(((px - M.left) / PLOT_W) * (n - 1))));
  };
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowRight") setActive(active === null ? 0 : Math.min(n - 1, active + 1));
    else if (e.key === "ArrowLeft") setActive(active === null ? n - 1 : Math.max(0, active - 1));
    else if (e.key === "Home") setActive(0);
    else if (e.key === "End") setActive(n - 1);
    else if (e.key === "Escape") setActive(null);
    else return;
    e.preventDefault();
  };

  const hovered = active === null ? null : points[active];
  const tooltipOnRight = active !== null && x(active) < W * 0.6;

  return (
    <div>
      <div className="relative">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          role="img"
          aria-label={`${metricLabel} by ${granularityLabel}, ${points[0].label} to ${points[n - 1].label}. Arrow keys read each point; the table below has every value.`}
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
                {tick(t, unit)}
              </text>
            </g>
          ))}
          {labelled.map((i) => (
            <text key={i} x={x(i)} y={H - 8} textAnchor={i === 0 ? "start" : i === n - 1 ? "end" : "middle"} className="fill-slate-500 text-[11px] dark:fill-slate-400">
              {points[i].label}
            </text>
          ))}

          <path d={area} className="fill-plum-600/15 dark:fill-plum-400/20" />
          <path d={line} fill="none" strokeWidth="2" strokeLinejoin="round" className="stroke-plum-600 dark:stroke-plum-400" />
          {n <= DOTS_UNTIL &&
            points.map((p, i) => <circle key={p.start} cx={x(i)} cy={y(p.value)} r="2.5" className="fill-plum-600 stroke-white dark:fill-plum-400 dark:stroke-slate-900" strokeWidth="1" />)}

          {hovered && active !== null && (
            <g pointerEvents="none">
              <line x1={x(active)} x2={x(active)} y1={M.top} y2={baseline} strokeWidth="1" className="stroke-slate-400 dark:stroke-slate-500" />
              <circle cx={x(active)} cy={y(hovered.value)} r="4" strokeWidth="2" className="fill-plum-600 stroke-white dark:fill-plum-400 dark:stroke-slate-900" />
            </g>
          )}
        </svg>

        {hovered && active !== null && (
          <div
            role="status"
            className="pointer-events-none absolute top-2 z-10 w-48 rounded-md border border-slate-200 bg-white p-2 text-xs shadow-md dark:border-slate-700 dark:bg-slate-900"
            style={tooltipOnRight ? { left: `${(x(active) / W) * 100 + 2}%` } : { right: `${100 - (x(active) / W) * 100 + 2}%` }}
          >
            <p className="text-slate-600 dark:text-slate-400">{granularityLabel === "day" ? hovered.label : `${granularityLabel === "week" ? "Week of" : ""} ${hovered.label}`.trim()}</p>
            <p className="mt-1 flex items-center justify-between gap-2">
              <span className="text-slate-600 dark:text-slate-400">{metricLabel}</span>
              <strong className="text-slate-900 dark:text-slate-100">{formatMetricValue(hovered.value, unit)}</strong>
            </p>
            <p className="mt-1 border-t border-slate-100 pt-1 text-slate-600 dark:border-slate-800 dark:text-slate-400">
              {hovered.plays} {hovered.plays === 1 ? "play" : "plays"} in {hovered.views} {hovered.views === 1 ? "visit" : "visits"}
              <br />
              {hovered.uniqueViewers} {hovered.uniqueViewers === 1 ? "viewer" : "viewers"}, {formatMetricValue(hovered.hoursWatched, "hours")} watched
            </p>
          </div>
        )}
      </div>

      <details className="mt-3 text-sm">
        <summary className="cursor-pointer text-plum-700 dark:text-plum-300">Table view</summary>
        <div className="mt-2 max-h-64 overflow-y-auto">
          <table className="w-full text-left text-xs">
            <thead className="sticky top-0 bg-white text-slate-600 dark:bg-slate-900 dark:text-slate-400">
              <tr>
                <th className="py-1 pr-3 font-medium">{granularityLabel === "day" ? "Day" : granularityLabel === "week" ? "Week of" : "Month"}</th>
                <th className="py-1 pr-3 text-right font-medium">{metricLabel}</th>
                <th className="py-1 pr-3 text-right font-medium">Plays</th>
                <th className="py-1 pr-3 text-right font-medium">Visits</th>
                <th className="py-1 text-right font-medium">Viewers</th>
              </tr>
            </thead>
            <tbody>
              {points.map((p) => (
                <tr key={p.start} className="border-t border-slate-100 dark:border-slate-800">
                  <td className="py-1 pr-3">{p.label}</td>
                  <td className="py-1 pr-3 text-right tabular-nums">{formatMetricValue(p.value, unit)}</td>
                  <td className="py-1 pr-3 text-right tabular-nums">{p.plays}</td>
                  <td className="py-1 pr-3 text-right tabular-nums">{p.views}</td>
                  <td className="py-1 text-right tabular-nums">{p.uniqueViewers}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}

type RectLike = Pick<DOMRect, "left" | "width">;
