import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdminPage } from "@/lib/admin-auth";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { loadCourseWatchStats } from "@/lib/courses/watch-stats-data";
import { formatClock } from "@/lib/courses/watch-stats";
import EngagementSparkline from "./EngagementSparkline";

export const metadata: Metadata = { title: "Watch stats · Courses" };

const percent = (fraction: number) => `${Math.round(fraction * 100)}%`;
const hours = (seconds: number) => `${(seconds / 3600).toFixed(1)} h`;

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-white p-4 shadow dark:bg-slate-900">
      <p className="text-sm text-slate-500 dark:text-slate-400">{label}</p>
      <p className="mt-1 text-3xl font-semibold tabular-nums">{value}</p>
    </div>
  );
}

export default async function CourseWatchStatsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ staff?: string }>;
}) {
  await requireAdminPage();
  const { id } = await params;
  const includeStaff = (await searchParams).staff === "1";
  const data = await loadCourseWatchStats(createServiceRoleClient(), id, { includeStaff });
  if (!data) notFound();

  const base = `/admin/courses/${id}/stats`;
  const withVideo = data.lessons.filter((l) => l.videoId);
  const watched = withVideo.filter((l) => l.stats);

  return (
    <div className="container mx-auto max-w-5xl px-6 py-8">
      <Link href={`/admin/courses/${id}`} className="text-sm text-slate-500 hover:underline dark:text-slate-400">
        ← {data.course.title}
      </Link>
      <h1 className="mt-2 text-3xl font-bold">Watch stats</h1>
      <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
        How members watched {data.course.title}, from the player&apos;s watch segments. Times are video time.{" "}
        {data.staffExcluded ? "Staff viewing is left out." : "Staff viewing is included."}{" "}
        <Link href={includeStaff ? base : `${base}?staff=1`} data-track="admin-watch-stats-staff-toggle" className="text-plum-700 underline dark:text-plum-300">
          {includeStaff ? "Leave out staff" : "Include staff"}
        </Link>
      </p>

      <div className="mt-6 grid gap-4 sm:grid-cols-3">
        <Tile label="Viewers" value={String(data.viewers)} />
        <Tile label="Time watched" value={hours(data.watchedSeconds)} />
        <Tile label="Lessons watched" value={`${watched.length} of ${withVideo.length}`} />
      </div>

      <div className="mt-6 overflow-x-auto rounded-lg bg-white p-6 shadow dark:bg-slate-900">
        <h2 className="text-lg font-semibold">Lessons</h2>
        {withVideo.length === 0 ? (
          <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">No lesson of this course has a video yet.</p>
        ) : (
          <table className="mt-3 w-full text-left text-sm">
            <thead className="text-slate-500 dark:text-slate-400">
              <tr>
                <th className="py-2 pr-4 font-medium">Lesson</th>
                <th className="py-2 pr-4 text-right font-medium">Viewers</th>
                <th className="py-2 pr-4 text-right font-medium">Avg watched</th>
                <th className="py-2 pr-4 text-right font-medium">Watched 90%+</th>
                <th className="py-2 font-medium">Engagement</th>
              </tr>
            </thead>
            <tbody>
              {withVideo.map(({ lesson, stats }) => (
                <tr key={lesson.id} className="border-t border-slate-100 dark:border-slate-800">
                  <td className="py-2 pr-4">
                    <Link href={`${base}/${lesson.id}${includeStaff ? "?staff=1" : ""}`} className="font-medium text-plum-700 underline dark:text-plum-300">
                      {lesson.title}
                    </Link>
                    {lesson.state === "coming_soon" && <span className="ml-2 text-xs text-slate-500 dark:text-slate-400">coming soon</span>}
                  </td>
                  <td className="py-2 pr-4 text-right tabular-nums">{stats ? stats.viewers : 0}</td>
                  <td className="py-2 pr-4 text-right tabular-nums">{stats ? percent(stats.averageWatchedFraction) : "–"}</td>
                  <td className="py-2 pr-4 text-right tabular-nums">{stats ? `${stats.watchedMarkViewers} of ${stats.viewers}` : "–"}</td>
                  <td className="py-2">
                    <EngagementSparkline
                      buckets={stats?.buckets ?? []}
                      label={stats ? `Engagement over the ${formatClock(stats.durationSeconds)} video` : "No views"}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
