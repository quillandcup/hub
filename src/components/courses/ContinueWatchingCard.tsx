import Link from "next/link";
import type { ContinueWatching } from "@/lib/courses/member";
import { safeUrl } from "@/lib/url";

/** Dashboard card to resume the lesson a member left off in. */
export default function ContinueWatchingCard({ item }: { item: ContinueWatching }) {
  const { course, lesson, progress } = item;
  const thumbnail = safeUrl(lesson.thumbnail_url) ?? safeUrl(course.thumbnail_url);
  const percent = progress.available > 0 ? Math.round((progress.completed / progress.available) * 100) : 0;
  return (
    <div className="@container mb-6">
      <Link
        href={item.href}
        data-track="dashboard-continue-watching"
        className="flex flex-col overflow-hidden rounded-lg border border-slate-200 bg-white hover:border-plum-300 @pair:flex-row dark:border-slate-800 dark:bg-slate-900"
      >
        {thumbnail && (
          // Decorative; a plain img so any Kajabi image host works.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={thumbnail} alt="" loading="lazy" className="aspect-video w-full object-cover @pair:w-40" />
        )}
        <div className="flex-1 p-4">
          <h2 className="text-sm font-medium uppercase tracking-wide text-slate-600 dark:text-slate-400">Continue watching</h2>
          <p className="mt-1 font-semibold text-slate-900 dark:text-slate-100">{lesson.title}</p>
          <p className="text-sm text-slate-600 dark:text-slate-400">{course.title}</p>
          <div
            role="progressbar"
            aria-label={`${course.title} progress`}
            aria-valuemin={0}
            aria-valuemax={progress.available}
            aria-valuenow={progress.completed}
            className="mt-3 h-1.5 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700"
          >
            <div className="h-full bg-plum-600" style={{ width: `${percent}%` }} />
          </div>
          <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">
            {progress.completed} of {progress.available} available {progress.available === 1 ? "lesson" : "lessons"} done
          </p>
        </div>
      </Link>
    </div>
  );
}
