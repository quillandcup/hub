"use client";

import { useEffect, useState } from "react";
import type { HeatBucket } from "@/lib/courses/watch-stats";
import { formatClock } from "@/lib/courses/watch-stats";

const STILL_BASE = "https://image.mux.com";

/** The share of plays that watched a slice, each counted by how much of the slice it covered. */
const engagementOf = (bucket: HeatBucket, plays: number) => (plays > 0 ? bucket.sessions / plays : 0);

/**
 * The video's frame with its engagement drawn over it, like Kajabi's: the shaded area is how many
 * plays watched each moment (scaled so the best-watched moment reaches the top), and moving the
 * pointer (or the arrow keys) shows the still from that moment, a vertical line, and a tooltip with
 * the time and the share of plays that watched it. `frames` are signed Mux thumbnail tokens, one per
 * slice, each for that slice's middle moment (Mux wants a signed still's time inside its token);
 * without them the overlay still works on a plain backdrop.
 */
export default function EngagementFrame({
  buckets,
  durationSeconds,
  plays,
  playbackId,
  frames,
}: {
  buckets: HeatBucket[];
  durationSeconds: number;
  plays: number;
  playbackId: string | null;
  frames: string[] | null;
}) {
  const [active, setActive] = useState<number | null>(null);
  const [shown, setShown] = useState<string | null>(null);
  const n = buckets.length;
  const index = active ?? 0;
  const stillUrl = playbackId && frames?.[index] ? `${STILL_BASE}/${playbackId}/thumbnail.webp?token=${frames[index]}` : null;

  // Keep the last still on screen until the next one has loaded, so moving the pointer doesn't flash the backdrop.
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

  if (n === 0) return null;

  const values = buckets.map((b) => engagementOf(b, plays));
  const peak = Math.max(...values, 0.0001);
  const xPct = (i: number) => (n === 1 ? 50 : ((i + 0.5) / n) * 100);
  const yOf = (v: number) => 100 - (v / peak) * 100;
  const line = values.map((v, i) => `${i === 0 ? "M" : "L"}${xPct(i).toFixed(2)},${yOf(v).toFixed(2)}`).join(" ");
  const area = `${line} L${xPct(n - 1).toFixed(2)},100 L${xPct(0).toFixed(2)},100 Z`;

  const nearest = (clientX: number, rect: DOMRect) => Math.max(0, Math.min(n - 1, Math.floor(((clientX - rect.left) / rect.width) * n)));
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
  const percent = hovered ? Math.round(engagementOf(hovered, plays) * 100) : 0;
  const flip = active !== null && xPct(active) > 62;

  return (
    <figure className="m-0">
      <div
        role="img"
        aria-label={`Engagement over the ${formatClock(durationSeconds)} video, drawn over its frames. Arrow keys read each moment: the time and the share of plays that watched it.`}
        tabIndex={0}
        onKeyDown={onKeyDown}
        onBlur={() => setActive(null)}
        onPointerMove={(e) => setActive(nearest(e.clientX, e.currentTarget.getBoundingClientRect()))}
        onPointerLeave={() => setActive(null)}
        className="relative aspect-video w-full touch-none overflow-hidden rounded-lg bg-slate-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-plum-500"
      >
        {shown && stillUrl && (
          // eslint-disable-next-line @next/next/no-img-element -- a signed, per-moment Mux still; next/image can't carry the token
          <img src={shown} alt="" className="absolute inset-0 h-full w-full object-cover" draggable={false} />
        )}
        {!stillUrl && <p className="absolute left-3 top-3 text-xs text-slate-300">Frame previews aren&apos;t available for this video.</p>}

        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-[55%] bg-gradient-to-t from-black/55 to-transparent" />
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="pointer-events-none absolute inset-x-0 bottom-0 h-[45%] w-full" aria-hidden="true">
          <path d={area} className="fill-plum-500/60" />
          <path d={line} fill="none" strokeWidth="2" vectorEffect="non-scaling-stroke" className="stroke-white" />
        </svg>

        {hovered && active !== null && (
          <>
            <div className="pointer-events-none absolute inset-y-0 w-px bg-white/90" style={{ left: `${xPct(active)}%` }} />
            <div
              role="status"
              className="pointer-events-none absolute top-2 rounded bg-slate-900/90 px-2 py-1 text-xs text-white shadow"
              style={flip ? { right: `${100 - xPct(active) + 1.5}%` } : { left: `${xPct(active) + 1.5}%` }}
            >
              <span className="block text-slate-300">{formatClock((hovered.start + hovered.end) / 2)}</span>
              <strong className="block">{percent}% engagement</strong>
            </div>
          </>
        )}
      </div>
      <figcaption className="mt-2 text-xs text-slate-500 dark:text-slate-400">
        Taller means more of the {plays} {plays === 1 ? "play" : "plays"} watched that moment. The best-watched moment reaches the top.
      </figcaption>
    </figure>
  );
}
