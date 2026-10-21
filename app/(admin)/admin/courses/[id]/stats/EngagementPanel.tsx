"use client";

import { useEffect, useState } from "react";
import type { HeatBucket } from "@/lib/courses/watch-stats";
import { formatClock } from "@/lib/courses/watch-stats";

const STILL_BASE = "https://image.mux.com";

const W = 720;
const MARGIN = { left: 44, right: 84, top: 12, bottom: 34 };
const PLOT_W = W - MARGIN.left - MARGIN.right;
/** The plot is 16:9 when it shows the frames (so a frame fits it exactly, uncropped) and shorter without. */
const PLOT_H = { frames: Math.round((PLOT_W * 9) / 16), plain: 200 };

const plays1 = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

/** A round number at or above `max`, so the top gridline is a clean value. */
function niceMax(max: number): number {
  if (max <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(max));
  return [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10].map((m) => m * magnitude).find((s) => s >= max) ?? max;
}

type SeriesKey = "timesWatched" | "plays" | "people";

/** The three counts, loosest first: every pass, then visits, then different people. Dash styles tell them apart as well as labels. */
const SERIES: { key: SeriesKey; label: string; short: string; stroke: string; width: number; dash?: string; fill?: string }[] = [
  { key: "timesWatched", label: "Times watched, rewatches included", short: "Watched", stroke: "stroke-plum-300", width: 2.5, fill: "fill-plum-400/35" },
  { key: "plays", label: "Plays (visits)", short: "Plays", stroke: "stroke-white", width: 2, dash: "2 3" },
  { key: "people", label: "People, each counted once", short: "People", stroke: "stroke-slate-200", width: 2, dash: "7 4" },
];

/** The share of all plays that watched a slice (0 to 1). */
const engagementOf = (bucket: HeatBucket, totalPlays: number) => (totalPlays > 0 ? bucket.plays / totalPlays : 0);

/**
 * Engagement for one video, in one panel: three counts per moment on a single axis, over the video's
 * own frames like Kajabi's heatmap. Each count is stricter than the last, so people <= plays <=
 * times watched:
 *  - **Times watched**: every pass over the moment, a rewind or replay counting each time (the area);
 *  - **Plays**: visits (player sessions) that watched it, so rewinding inside a visit is still one;
 *  - **People**: different members, each counted once however often or on however many visits.
 * One person watching a part twice in one visit is 2, 1, 1; coming back another day is 2, 2, 1. With
 * nothing replayed the three lines coincide.
 *
 * Moving the pointer (or the arrow keys) shows the still from that moment, a vertical line, and a
 * tooltip with the three counts and the share of plays that watched it. `frames` are signed Mux
 * thumbnail tokens, one per slice, each for that slice's middle moment (Mux wants a signed still's
 * time inside its token). Without them, with `showFrames={false}`, or with the toggle off, the same
 * chart draws on a plain dark panel. A table view has every value.
 */
export default function EngagementPanel({
  buckets,
  durationSeconds,
  totalPlays,
  playbackId,
  frames,
  showFrames = true,
}: {
  buckets: HeatBucket[];
  durationSeconds: number;
  /** All plays of the video: the denominator of a moment's engagement. */
  totalPlays: number;
  playbackId: string | null;
  /** One signed thumbnail token per slice, or null when stills can't be shown. */
  frames: string[] | null;
  /** Set false in a view that never wants the frames behind the chart. */
  showFrames?: boolean;
}) {
  const [active, setActive] = useState<number | null>(null);
  const [wantFrames, setWantFrames] = useState(true);
  const [shown, setShown] = useState<string | null>(null);
  const n = buckets.length;
  const index = active ?? 0;

  const canShowFrames = showFrames && Boolean(playbackId && frames);
  const framesOn = canShowFrames && wantFrames;
  const stillUrl = framesOn && frames?.[index] ? `${STILL_BASE}/${playbackId}/thumbnail.webp?token=${frames[index]}` : null;

  // Keep the last still on screen until the next has loaded, so moving the pointer doesn't flash the backdrop.
  useEffect(() => {
    if (!stillUrl) return;
    let cancelled = false;
    const img = new Image();
    img.onload = () => {
      if (!cancelled) setShown(stillUrl);
    };
    img.src = stillUrl;
    return () => {
      cancelled = true;
    };
  }, [stillUrl]);

  if (n === 0) return <p className="text-sm text-slate-500 dark:text-slate-400">Nobody has watched this video yet.</p>;

  const plotH = framesOn ? PLOT_H.frames : PLOT_H.plain;
  const plotTop = MARGIN.top;
  const H = plotTop + plotH + MARGIN.bottom;
  const pct = (value: number, of: number) => `${(value / of) * 100}%`;
  const top = niceMax(Math.max(...buckets.map((b) => b.timesWatched)));
  const x = (i: number) => MARGIN.left + (n === 1 ? PLOT_W / 2 : (i / (n - 1)) * PLOT_W);
  const y = (v: number) => plotTop + plotH - (v / top) * plotH;
  const baseline = y(0);

  const line = (key: SeriesKey) => buckets.map((b, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(b[key]).toFixed(1)}`).join(" ");
  const area = `${line("timesWatched")} L${x(n - 1).toFixed(1)},${baseline} L${x(0).toFixed(1)},${baseline} Z`;

  // Direct labels at the right end, nudged apart (top to bottom) where the lines end close together, then
  // lifted back up if that pushed the last one below the axis (all three often end together at zero).
  const last = buckets[n - 1];
  const labelYs = SERIES.map((s) => ({ key: s.key, y: y(last[s.key]) })).sort((a, b) => a.y - b.y);
  for (let i = 1; i < labelYs.length; i++) if (labelYs[i].y - labelYs[i - 1].y < 14) labelYs[i].y = labelYs[i - 1].y + 14;
  const overflow = labelYs[labelYs.length - 1].y - (baseline + 4);
  if (overflow > 0) for (const l of labelYs) l.y -= overflow;
  const labelY = (key: SeriesKey) => labelYs.find((l) => l.key === key)!.y;

  const yTicks = [0, top / 2, top];
  const xTicks = [0, 0.25, 0.5, 0.75, 1];

  const nearest = (clientX: number, rect: Pick<DOMRect, "left" | "width">) => {
    const px = ((clientX - rect.left) / rect.width) * W;
    return Math.max(0, Math.min(n - 1, Math.round(((px - MARGIN.left) / PLOT_W) * (n - 1))));
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

  const hovered = active === null ? null : buckets[active];
  const percent = hovered ? Math.round(engagementOf(hovered, totalPlays) * 100) : 0;
  const tooltipOnRight = active !== null && x(active) < W * 0.6;

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-x-5 gap-y-2">
        <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-sm text-slate-700 dark:text-slate-300">
          {SERIES.map((s) => (
            <span key={s.key} className="inline-flex items-center gap-2">
              {s.fill ? (
                <span aria-hidden="true" className="inline-block h-3 w-5 rounded-sm bg-plum-600/30 ring-1 ring-inset ring-plum-600 dark:bg-plum-400/30 dark:ring-plum-400" />
              ) : (
                <svg aria-hidden="true" width="20" height="8" className={`${s.key === "plays" ? "stroke-slate-900 dark:stroke-white" : "stroke-slate-500 dark:stroke-slate-300"}`}>
                  <line x1="0" y1="4" x2="20" y2="4" strokeWidth="2" strokeDasharray={s.dash} />
                </svg>
              )}
              {s.label}
            </span>
          ))}
        </div>
        {canShowFrames && (
          <label className="inline-flex cursor-pointer items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
            <input type="checkbox" checked={wantFrames} onChange={(e) => setWantFrames(e.target.checked)} data-track="admin-watch-stats-frames-toggle" className="h-4 w-4 accent-plum-600" />
            Show video frames
          </label>
        )}
      </div>

      <div
        role="img"
        aria-label={`Engagement over the ${formatClock(durationSeconds)} video: times watched, plays and people by moment${framesOn ? ", drawn over its frames" : ""}. Arrow keys read each moment; the table below has every value.`}
        tabIndex={0}
        onKeyDown={onKeyDown}
        onBlur={() => setActive(null)}
        onPointerMove={(e) => setActive(nearest(e.clientX, e.currentTarget.getBoundingClientRect()))}
        onPointerLeave={() => setActive(null)}
        style={{ aspectRatio: `${W} / ${H}` }}
        className="relative w-full touch-none overflow-hidden rounded-lg bg-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-plum-500"
      >
        {/* The frame lives only inside the plot, so the axes and labels around it sit on a solid background and stay readable. */}
        <div
          className="pointer-events-none absolute overflow-hidden rounded-sm bg-slate-800"
          style={{ left: pct(MARGIN.left, W), top: pct(plotTop, H), width: pct(PLOT_W, W), height: pct(plotH, H) }}
        >
          {framesOn && shown && stillUrl && (
            // eslint-disable-next-line @next/next/no-img-element -- a signed, per-moment Mux still; next/image can't carry the token
            <img src={shown} alt="" className="absolute inset-0 h-full w-full object-cover" draggable={false} />
          )}
          {framesOn && <div className="absolute inset-0 bg-slate-950/60" />}
          {showFrames && !canShowFrames && <p className="absolute left-3 top-3 text-xs text-slate-300">Frame previews aren&apos;t available for this video.</p>}
        </div>

        <svg viewBox={`0 0 ${W} ${H}`} className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden="true">
          {yTicks.map((t) => (
            <g key={t}>
              <line x1={MARGIN.left} x2={W - MARGIN.right} y1={y(t)} y2={y(t)} strokeWidth="1" className="stroke-white/25" />
              <text x={MARGIN.left - 6} y={y(t)} textAnchor="end" dominantBaseline="middle" className="fill-slate-200 text-[11px]">
                {plays1(t)}
              </text>
            </g>
          ))}
          {xTicks.map((f) => (
            <text key={f} x={MARGIN.left + f * PLOT_W} y={H - 10} textAnchor={f === 0 ? "start" : f === 1 ? "end" : "middle"} className="fill-slate-200 text-[11px]">
              {formatClock(f * durationSeconds)}
            </text>
          ))}

          <path d={area} className="fill-plum-400/60" />
          {SERIES.map((s) => (
            <path key={s.key} d={line(s.key)} fill="none" strokeWidth={s.width} strokeDasharray={s.dash} strokeLinejoin="round" className={s.stroke} />
          ))}

          {SERIES.map((s) => (
            <text key={s.key} x={W - MARGIN.right + 8} y={labelY(s.key)} dominantBaseline="middle" className="fill-slate-100 text-[11px]">
              {s.short}
            </text>
          ))}

          {hovered && active !== null && (
            <g>
              <line x1={x(active)} x2={x(active)} y1={plotTop} y2={baseline} strokeWidth="1" className="stroke-white/80" />
              {SERIES.map((s) => (
                <circle key={s.key} cx={x(active)} cy={y(hovered[s.key])} r="3.5" strokeWidth="1.5" className={`fill-slate-900 ${s.stroke}`} />
              ))}
            </g>
          )}
        </svg>

        {hovered && active !== null && (
          <div
            role="status"
            className="pointer-events-none absolute w-52 rounded-md bg-slate-900/90 p-2 text-xs text-white shadow ring-1 ring-white/15"
            style={{ top: `calc(${pct(plotTop, H)} + 8px)`, ...(tooltipOnRight ? { left: `${(x(active) / W) * 100 + 1.5}%` } : { right: `${100 - (x(active) / W) * 100 + 1.5}%` }) }}
          >
            <p className="text-slate-300">
              {formatClock(hovered.start)} to {formatClock(hovered.end)}
            </p>
            {SERIES.map((s) => (
              <p key={s.key} className="mt-1 flex items-center justify-between gap-2">
                <span className="inline-flex items-center gap-1.5 text-slate-200">
                  <svg aria-hidden="true" width="14" height="6" className={s.stroke}>
                    <line x1="0" y1="3" x2="14" y2="3" strokeWidth="2" strokeDasharray={s.dash} />
                  </svg>
                  {s.key === "timesWatched" ? "Times watched" : s.short}
                </span>
                <strong>{plays1(hovered[s.key])}</strong>
              </p>
            ))}
            <p className="mt-1 border-t border-white/15 pt-1 text-slate-200">
              <strong className="text-white">{percent}%</strong> of plays watched this
            </p>
          </div>
        )}
      </div>

      <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
        Three counts of each moment, each stricter than the last: every pass over it, then plays (visits, so a rewind inside one is still one), then different people. One person watching a part twice in a visit is 2, 1, 1; coming back another day is 2, 2, 1.
      </p>

      <details className="mt-3 text-sm">
        <summary className="cursor-pointer text-plum-700 dark:text-plum-300">Table view</summary>
        <div className="mt-2 max-h-64 overflow-y-auto">
          <table className="w-full text-left text-xs">
            <thead className="sticky top-0 bg-white text-slate-500 dark:bg-slate-900 dark:text-slate-400">
              <tr>
                <th className="py-1 pr-3 font-medium">Moment</th>
                <th className="py-1 pr-3 text-right font-medium">Times watched</th>
                <th className="py-1 pr-3 text-right font-medium">Plays</th>
                <th className="py-1 pr-3 text-right font-medium">People</th>
                <th className="py-1 text-right font-medium">% of plays</th>
              </tr>
            </thead>
            <tbody>
              {buckets.map((b) => (
                <tr key={b.start} className="border-t border-slate-100 dark:border-slate-800">
                  <td className="py-1 pr-3">
                    {formatClock(b.start)} to {formatClock(b.end)}
                  </td>
                  <td className="py-1 pr-3 text-right tabular-nums">{plays1(b.timesWatched)}</td>
                  <td className="py-1 pr-3 text-right tabular-nums">{plays1(b.plays)}</td>
                  <td className="py-1 pr-3 text-right tabular-nums">{plays1(b.people)}</td>
                  <td className="py-1 text-right tabular-nums">{Math.round(engagementOf(b, totalPlays) * 100)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
