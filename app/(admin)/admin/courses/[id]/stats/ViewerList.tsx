import Link from "next/link";
import { formatCourseDateTime } from "@/lib/courses/format";
import { describeDevice } from "@/lib/device-label";
import { formatClock } from "@/lib/courses/watch-stats";
import type { ViewSession } from "@/lib/courses/watch-stats-data";

const percent = (fraction: number) => `${Math.round(fraction * 100)}%`;

/** Which parts were covered, as "0:00 to 1:36, 2:10 to 2:40", for the bar's text alternative. */
function describeCoverage(intervals: [number, number][], durationSeconds: number): string {
  if (intervals.length === 0) return "nothing played";
  return intervals.map(([a, b]) => `${formatClock(a * durationSeconds)} to ${formatClock(b * durationSeconds)}`).join(", ");
}

/**
 * One row per visit to the lesson (a player session), newest first, like Kajabi's "Video stats": who,
 * when, a bar of which parts of the video they covered and how much, and on opening a row the device,
 * where it came from (the access log's place and IP) and how long they played. A visit where the player appeared but nothing was played shows an empty bar.
 */
export default function ViewerList({
  sessions,
  durationSeconds,
  shown,
  more,
}: {
  sessions: ViewSession[];
  durationSeconds: number;
  /** How many rows to show. */
  shown: number;
  /** Where "Load more" goes, or null when there is nothing more to show. */
  more: string | null;
}) {
  if (sessions.length === 0) return <p className="text-sm text-slate-600 dark:text-slate-300">Nobody has opened this lesson&apos;s video yet.</p>;
  const rows = sessions.slice(0, shown);

  return (
    <div>
      <ul className="space-y-3">
        {rows.map((s) => (
          <li key={s.sessionId} className="rounded-lg border border-slate-200 dark:border-slate-800">
            <details className="@container group">
              <summary className="flex cursor-pointer list-none flex-wrap items-center gap-x-4 gap-y-2 p-3 focus:outline-none focus-visible:ring-2 focus-visible:ring-plum-500 @pair:flex-nowrap">
                <span className="w-44 shrink-0 text-sm text-slate-600 dark:text-slate-300">{s.startedAt ? formatCourseDateTime(s.startedAt) : "Unknown time"}</span>
                <span className="w-40 shrink-0 text-sm font-medium">
                  <Link href={`/admin/members/${s.memberId}`} className="text-plum-700 underline dark:text-plum-300">
                    {s.memberName}
                  </Link>
                </span>
                <span
                  role="img"
                  aria-label={`Covered ${percent(s.coveredFraction)} of the video: ${describeCoverage(s.intervals, durationSeconds)}`}
                  className="relative h-8 min-w-40 flex-1 overflow-hidden rounded border border-slate-300 bg-white dark:border-slate-600 dark:bg-slate-950"
                >
                  {s.intervals.map(([a, b]) => (
                    <span key={a} className="absolute inset-y-0 bg-plum-400/70 dark:bg-plum-400/60" style={{ left: `${a * 100}%`, width: `${Math.max((b - a) * 100, 0.5)}%` }} />
                  ))}
                  <span className="absolute inset-y-0 right-1 flex items-center">
                    <span className="rounded bg-slate-100 px-1.5 text-xs tabular-nums text-slate-700 dark:bg-slate-800 dark:text-slate-300">{percent(s.coveredFraction)}</span>
                  </span>
                </span>
                <span aria-hidden="true" className="text-slate-400 transition group-open:rotate-180">
                  &#9662;
                </span>
              </summary>
              <dl className="grid grid-cols-[6rem_1fr] gap-y-1 border-t border-slate-100 p-3 text-sm dark:border-slate-800">
                <dt className="text-slate-500 dark:text-slate-400">Device</dt>
                <dd>{describeDevice(s.userAgent)}</dd>
                <dt className="text-slate-500 dark:text-slate-400">Location</dt>
                <dd>{s.location?.place ?? "Not recorded"}</dd>
                <dt className="text-slate-500 dark:text-slate-400">IP</dt>
                <dd className="tabular-nums">{s.location?.ip ?? "Not recorded"}</dd>
                <dt className="text-slate-500 dark:text-slate-400">Played</dt>
                <dd className="tabular-nums">{s.played ? `${formatClock(s.watchedSeconds)} of video time` : "Not played"}</dd>
                <dt className="text-slate-500 dark:text-slate-400">Covered</dt>
                <dd>{describeCoverage(s.intervals, durationSeconds)}</dd>
              </dl>
            </details>
          </li>
        ))}
      </ul>
      {more && (
        <p className="mt-4">
          <Link href={more} data-track="admin-watch-stats-load-more" className="text-plum-700 underline dark:text-plum-300">
            Load more
          </Link>
          <span className="ml-3 text-sm text-slate-500 dark:text-slate-400">
            Showing {rows.length} of {sessions.length}
          </span>
        </p>
      )}
    </div>
  );
}
