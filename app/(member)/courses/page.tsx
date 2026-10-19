import type { Metadata } from "next";
import Link from "next/link";
import { requireCoursesPage } from "@/lib/courses/caller";
import { loadCourseList } from "@/lib/courses/member";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { formatCourseDate } from "@/lib/courses/format";

export const metadata: Metadata = { title: "Courses" };

export default async function CoursesPage() {
  const caller = await requireCoursesPage();
  const items = await loadCourseList(createServiceRoleClient(), caller.scope);

  return (
    <div className="container mx-auto max-w-3xl px-6 py-8">
      <h1 className="mb-2 text-3xl font-bold">Courses</h1>
      <p className="mb-8 text-sm text-slate-500 dark:text-slate-400">
        Your courses, with where you are in each one.
      </p>

      {items.length === 0 ? (
        <div className="rounded-lg border border-slate-200 bg-white p-6 text-sm text-slate-600 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300">
          You don&apos;t have any courses yet. Once you join one, it shows up here.
        </div>
      ) : (
        <ul className="space-y-4">
          {items.map(({ course, access, progress }) => {
            const ended = access.kind === "ended";
            const upcoming = access.kind === "upcoming";
            const href = ended || !progress.continueLessonId ? `/courses/${course.slug}` : `/courses/${course.slug}/lessons/${progress.continueLessonId}`;
            const percent = progress.available > 0 ? Math.round((progress.completed / progress.available) * 100) : 0;
            const started = progress.completed > 0;
            return (
              <li key={course.id} className="rounded-lg border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="text-xl font-semibold">
                      <Link href={`/courses/${course.slug}`} className="hover:underline">
                        {course.title}
                      </Link>
                    </h2>
                    {course.description && <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">{course.description}</p>}
                  </div>
                  {ended && (
                    <span className="rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                      Access ended {formatCourseDate(access.endsAt)}
                    </span>
                  )}
                  {upcoming && (
                    <span className="rounded-full bg-plum-50 px-3 py-1 text-xs text-plum-800 dark:bg-slate-800 dark:text-plum-300">
                      Opens {formatCourseDate(access.startsAt)}
                    </span>
                  )}
                </div>

                {upcoming ? (
                  <p className="mt-4 text-sm text-slate-600 dark:text-slate-300">
                    You&apos;re in. The course opens on {formatCourseDate(access.startsAt)}, and your access starts then.
                  </p>
                ) : (
                  <>
                  <div className="mt-4">
                    <div
                      role="progressbar"
                      aria-label={`${course.title} progress`}
                      aria-valuemin={0}
                      aria-valuemax={progress.available}
                      aria-valuenow={progress.completed}
                      className="h-2 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700"
                    >
                      <div className="h-full bg-plum-600" style={{ width: `${percent}%` }} />
                    </div>
                    <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
                      {progress.completed} of {progress.available} available {progress.available === 1 ? "lesson" : "lessons"} done
                    </p>
                  </div>

                  <Link
                    href={href}
                    className="mt-4 inline-block rounded-lg bg-plum-600 px-4 py-2 text-sm font-medium text-white hover:bg-plum-700"
                  >
                    {ended ? "View progress" : progress.allDone ? "Review" : started ? "Continue" : "Start"}
                  </Link>
                  </>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
