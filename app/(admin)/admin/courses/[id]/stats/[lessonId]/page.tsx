import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdminPage } from "@/lib/admin-auth";
import { isUuid } from "@/lib/chat/format";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { loadCourseWatchStats } from "@/lib/courses/watch-stats-data";
import { formatClock } from "@/lib/courses/watch-stats";
import { createMuxClient, signThumbnailTokens } from "@/lib/mux";
import EngagementChart from "../EngagementChart";
import EngagementFrame from "../EngagementFrame";
import ViewerList from "../ViewerList";
import TimeSeriesSection from "../TimeSeriesSection";
import { ORG_TIMEZONE } from "@/lib/config";
import { computeTimeSeries, parseTimeSeriesQuery, resolveRange, localDate } from "@/lib/courses/watch-timeseries";

export const metadata: Metadata = { title: "Lesson watch stats · Courses" };

const PAGE_SIZE = 20;
const MAX_LIMIT = 1000;

const percent = (fraction: number) => `${Math.round(fraction * 100)}%`;

/** A stat tile that opens to say what the number means. */
function Tile({ label, value, definition, hint }: { label: string; value: string; definition: string; hint?: string }) {
  return (
    <details className="group rounded-lg bg-white p-4 shadow dark:bg-slate-900">
      <summary className="flex cursor-pointer list-none items-start justify-between gap-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-plum-500">
        <span>
          <span className="block text-sm text-slate-500 dark:text-slate-400">{label}</span>
          <span className="mt-1 block text-3xl font-semibold tabular-nums">{value}</span>
          {hint && <span className="mt-1 block text-xs text-slate-500 dark:text-slate-400">{hint}</span>}
        </span>
        <span aria-hidden="true" className="mt-1 text-slate-400 transition group-open:rotate-180">
          &#9662;
        </span>
      </summary>
      <p className="mt-3 text-sm text-slate-600 dark:text-slate-300">{definition}</p>
    </details>
  );
}

export default async function LessonWatchStatsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string; lessonId: string }>;
  searchParams: Promise<{ staff?: string; limit?: string; metric?: string; by?: string; range?: string; from?: string; to?: string }>;
}) {
  await requireAdminPage();
  const { id, lessonId } = await params;
  if (!isUuid(lessonId)) notFound();
  const query = await searchParams;
  const includeStaff = query.staff === "1";
  // How many visits to list; "Load more" asks for another page of them.
  const limit = Math.min(Math.max(Number.parseInt(query.limit ?? "", 10) || PAGE_SIZE, PAGE_SIZE), MAX_LIMIT);
  const data = await loadCourseWatchStats(createServiceRoleClient(), id, { includeStaff, lessonId, withSessions: true, sessionLimit: limit });
  const entry = data?.lessons[0];
  if (!data || !entry) notFound();

  const { lesson, stats, sessions } = entry;

  // What "Load more" keeps, so paging the visits doesn't reset the staff choice or the chart's controls.
  const carriedParams = (["staff", "metric", "by", "range", "from", "to"] as const)
    .filter((key) => query[key])
    .map((key) => `&${key}=${encodeURIComponent(query[key] as string)}`)
    .join("");

  // "Over time": the chosen metric by day, week or month over the chosen range, from the visits above.
  const controls = parseTimeSeriesQuery(query);
  const earliest = sessions.reduce<string | null>((first, x) => {
    const day = x.startedAt ? localDate(x.startedAt, ORG_TIMEZONE) : null;
    return day && (!first || day < first) ? day : first;
  }, null);
  const series = stats
    ? computeTimeSeries(sessions, {
        metric: controls.metric,
        granularity: controls.granularity,
        range: resolveRange(controls.preset, new Date(), ORG_TIMEZONE, { custom: { from: controls.from, to: controls.to }, earliest }),
        timeZone: ORG_TIMEZONE,
        durationSeconds: stats.durationSeconds,
      })
    : null;

  // A still of the video for each slice (the hover frames). Failing to sign them just leaves the heatmap on a plain backdrop.
  let frames: string[] | null = null;
  if (stats && entry.playbackId) {
    try {
      frames = await signThumbnailTokens(
        createMuxClient(),
        entry.playbackId,
        stats.buckets.map((b) => (b.start + b.end) / 2),
      );
    } catch (error) {
      console.error("Couldn't sign Mux thumbnail tokens:", error instanceof Error ? error.message : error);
    }
  }
  const base = `/admin/courses/${id}/stats`;
  const here = `${base}/${lessonId}`;

  return (
    <div className="container mx-auto max-w-5xl px-6 py-8">
      <Link href={`${base}${includeStaff ? "?staff=1" : ""}`} className="text-sm text-slate-500 hover:underline dark:text-slate-400">
        ← Watch stats
      </Link>
      <h1 className="mt-2 text-3xl font-bold">{lesson.title}</h1>
      <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
        {data.staffExcluded ? "Staff viewing is left out." : "Staff viewing is included."}{" "}
        <Link href={includeStaff ? here : `${here}?staff=1`} data-track="admin-watch-stats-staff-toggle" className="text-plum-700 underline dark:text-plum-300">
          {includeStaff ? "Leave out staff" : "Include staff"}
        </Link>
        {" · "}
        <Link href={`/courses/${data.course.slug}/lessons/${lesson.id}`} className="text-plum-700 underline dark:text-plum-300">
          {lesson.state === "coming_soon" ? "Preview lesson" : "View lesson"}
        </Link>
      </p>

      {!entry.videoId ? (
        <p className="mt-6 rounded-lg bg-white p-6 text-sm text-slate-600 shadow dark:bg-slate-900 dark:text-slate-300">This lesson has no video.</p>
      ) : !stats ? (
        <p className="mt-6 rounded-lg bg-white p-6 text-sm text-slate-600 shadow dark:bg-slate-900 dark:text-slate-300">
          Nobody has watched this video yet{data.staffExcluded ? " (staff viewing is left out)" : ""}.
        </p>
      ) : (
        <>
          <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Tile
              label="Engagement"
              value={percent(stats.engagementRate)}
              definition="How much of the video people play: total watch time divided by (total plays × video length). Replaying a part within a play adds to it, so it can pass 100%."
            />
            <Tile
              label="Total plays"
              value={String(stats.plays)}
              definition="Times the video was played: one for each visit to the lesson with at least one stretch watched. The same member coming back another day counts again."
            />
            <Tile
              label="Play rate"
              value={percent(stats.playRate)}
              hint={`${stats.plays} of ${stats.views} ${stats.views === 1 ? "visit" : "visits"}`}
              definition="The percentage of visits to the lesson, where the video appeared, in which it was played."
            />
            <Tile label="Viewers" value={String(stats.viewers)} definition="Different members who watched any of the video." />
            <Tile
              label="Average watched"
              value={percent(stats.averageWatchedFraction)}
              hint="of the video, per viewer"
              definition="On average, the share of the video each viewer covered, counting each part once however often they replayed it."
            />
            <Tile
              label="Watched 90%+"
              value={`${stats.watchedMarkViewers} of ${stats.viewers}`}
              hint="covered at least 90% of it"
              definition="Viewers who covered at least 90% of the video (Kajabi's mark for a lesson watched)."
            />
            <Tile
              label="Rewatched"
              value={formatClock(Math.max(0, stats.watchedSeconds - stats.uniqueWatchedSeconds))}
              hint={`of ${formatClock(stats.watchedSeconds)} played`}
              definition="Video time viewers replayed after already watching it: the time played minus the time covered. It leaves out two different members watching the same part."
            />
          </div>

          {series && <TimeSeriesSection series={series} preset={controls.preset} action={here} staff={includeStaff} />}

          <div className="mt-6 rounded-lg bg-white p-6 shadow dark:bg-slate-900">
            <h2 className="text-lg font-semibold">Heatmap</h2>
            <p className="mb-3 mt-1 text-sm text-slate-600 dark:text-slate-300">Move over the video to see each moment and how many plays watched it.</p>
            <EngagementFrame buckets={stats.buckets} durationSeconds={stats.durationSeconds} plays={stats.plays} playbackId={entry.playbackId} frames={frames} />
          </div>

          <div className="mt-6 rounded-lg bg-white p-6 shadow dark:bg-slate-900">
            <h2 className="text-lg font-semibold">Engagement</h2>
            <p className="mb-3 mt-1 text-sm text-slate-600 dark:text-slate-300">
              How often each moment of the {formatClock(stats.durationSeconds)} video was played. Where plays rise above viewers, people watched it again.
            </p>
            <EngagementChart buckets={stats.buckets} durationSeconds={stats.durationSeconds} />
          </div>

          <div className="mt-6 rounded-lg bg-white p-6 shadow dark:bg-slate-900">
            <h2 className="text-lg font-semibold">How it was watched</h2>
            <dl className="mt-3 grid gap-x-8 gap-y-3 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-slate-500 dark:text-slate-400">Playback speed (share of time played)</dt>
                <dd className="mt-1">
                  <ul>
                    {stats.speeds.map((s) => (
                      <li key={s.rate} className="flex justify-between gap-4 tabular-nums">
                        <span>{s.rate}x</span>
                        <span>{percent(s.seconds / stats.watchedSeconds)}</span>
                      </li>
                    ))}
                  </ul>
                </dd>
              </div>
              <div className="space-y-3">
                <div>
                  <dt className="text-slate-500 dark:text-slate-400">Captions on</dt>
                  <dd className="mt-1 tabular-nums">{percent(stats.captionsShare)} of the time played</dd>
                </div>
                <div>
                  <dt className="text-slate-500 dark:text-slate-400">Played with the tab in the background</dt>
                  <dd className="mt-1 tabular-nums">{percent(stats.backgroundShare)} of the time played</dd>
                </div>
              </div>
            </dl>
          </div>

          <div className="mt-6 rounded-lg bg-white p-6 shadow dark:bg-slate-900">
            <h2 className="text-lg font-semibold">Views</h2>
            <p className="mb-3 mt-1 text-sm text-slate-600 dark:text-slate-300">Each visit to the lesson, newest first. The bar shows which parts of the video were covered.</p>
            <ViewerList
              sessions={sessions}
              durationSeconds={stats.durationSeconds}
              shown={limit}
              more={sessions.length > limit ? `${here}?limit=${limit + PAGE_SIZE}${carriedParams}` : null}
            />
          </div>
        </>
      )}
    </div>
  );
}
