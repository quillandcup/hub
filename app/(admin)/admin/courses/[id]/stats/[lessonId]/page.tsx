import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdminPage } from "@/lib/admin-auth";
import { isUuid } from "@/lib/chat/format";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { loadCourseWatchStats } from "@/lib/courses/watch-stats-data";
import { formatClock } from "@/lib/courses/watch-stats";
import EngagementChart from "../EngagementChart";

export const metadata: Metadata = { title: "Lesson watch stats · Courses" };

const percent = (fraction: number) => `${Math.round(fraction * 100)}%`;

function Tile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg bg-white p-4 shadow dark:bg-slate-900">
      <p className="text-sm text-slate-500 dark:text-slate-400">{label}</p>
      <p className="mt-1 text-3xl font-semibold tabular-nums">{value}</p>
      {hint && <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{hint}</p>}
    </div>
  );
}

export default async function LessonWatchStatsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string; lessonId: string }>;
  searchParams: Promise<{ staff?: string }>;
}) {
  await requireAdminPage();
  const { id, lessonId } = await params;
  if (!isUuid(lessonId)) notFound();
  const includeStaff = (await searchParams).staff === "1";
  const data = await loadCourseWatchStats(createServiceRoleClient(), id, { includeStaff, lessonId });
  const entry = data?.lessons[0];
  if (!data || !entry) notFound();

  const { lesson, stats } = entry;
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
          <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Tile label="Viewers" value={String(stats.viewers)} />
            <Tile label="Average watched" value={percent(stats.averageWatchedFraction)} hint="of the video, per viewer" />
            <Tile label="Watched 90%+" value={`${stats.watchedMarkViewers} of ${stats.viewers}`} hint="covered at least 90% of it" />
            <Tile
              label="Rewatched"
              value={formatClock(Math.max(0, stats.watchedSeconds - stats.uniqueWatchedSeconds))}
              hint={`of ${formatClock(stats.watchedSeconds)} played`}
            />
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
        </>
      )}
    </div>
  );
}
