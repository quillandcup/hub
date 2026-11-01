import type { Metadata } from "next";
import Link from "next/link";
import { requireCoursesPage } from "@/lib/courses/caller";
import { loadCourseList } from "@/lib/courses/member";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { formatCourseDate } from "@/lib/courses/format";
import { courseImageUrl } from "@/lib/courses/image-urls";

export const metadata: Metadata = { title: "Courses" };

export default async function CoursesPage() {
  const caller = await requireCoursesPage();
  const items = await loadCourseList(createServiceRoleClient(), caller.scope);

  return (
    <div className="container mx-auto max-w-5xl px-6 py-8">
      <h1 className="mb-2 text-3xl font-bold">Courses</h1>
      <p className="mb-8 text-sm text-slate-600 dark:text-slate-400">
        Your courses, with where you are in each one.
      </p>

      {items.length === 0 ? (
        <div className="rounded-lg border border-slate-200 bg-white p-6 text-sm text-slate-600 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300">
          You don&apos;t have any courses yet. Once you join one, it shows up here.
        </div>
      ) : (
        <div className="@container">
          <ul className="grid gap-6 @pair:grid-cols-2 @columns:grid-cols-3">
          {items.map(({ course, access, progress }) => {
            const ended = access.kind === "ended";
            const upcoming = access.kind === "upcoming";
            const courseHref = `/courses/${course.slug}`;
            const href = ended || !progress.continueLessonId ? courseHref : `${courseHref}/lessons/${progress.continueLessonId}`;
            const percent = progress.available > 0 ? Math.round((progress.completed / progress.available) * 100) : 0;
            const started = progress.completed > 0;
            const thumbnail = courseImageUrl(course.thumbnail_url);
            return (
              <li
                key={course.id}
                className="flex flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900"
              >
                <Link data-track="courses-open-course-image" href={courseHref} tabIndex={-1} aria-hidden="true" className="relative block aspect-video bg-plum-50 dark:bg-slate-800">
                  {thumbnail ? (
                    // Decorative (the title is below); a plain img so any Kajabi image host works.
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={thumbnail} alt="" loading="lazy" className="h-full w-full object-cover" />
                  ) : (
                    <span className="flex h-full w-full items-center justify-center bg-gradient-to-br from-plum-100 to-plum-50 px-6 text-center font-display text-2xl font-semibold text-plum-800 dark:from-slate-800 dark:to-slate-900 dark:text-plum-300">
                      {course.title}
                    </span>
                  )}
                  {course.is_draft && (
                    <span className="absolute left-3 top-3 rounded-full bg-white/90 px-3 py-1 text-xs text-slate-700 shadow-sm">Draft: only staff see this</span>
                  )}
                  {ended && (
                    <span className="absolute right-3 top-3 rounded-full bg-white/90 px-3 py-1 text-xs text-slate-700 shadow-sm">
                      Access ended {formatCourseDate(access.endsAt)}
                    </span>
                  )}
                  {upcoming && (
                    <span className="absolute right-3 top-3 rounded-full bg-white/90 px-3 py-1 text-xs text-plum-800 shadow-sm">
                      Opens {formatCourseDate(access.startsAt)}
                    </span>
                  )}
                </Link>

                <div className="flex flex-1 flex-col p-5">
                  <h2 className="text-lg font-semibold leading-snug">
                    <Link data-track="courses-open-course" href={courseHref} className="hover:underline">
                      {course.title}
                    </Link>
                  </h2>
                  {course.description && (
                    <p className="mt-1 line-clamp-3 text-sm text-slate-600 dark:text-slate-300">{course.description}</p>
                  )}

                  <div className="mt-auto pt-4">
                    {upcoming ? (
                      <p className="text-sm text-slate-600 dark:text-slate-300">
                        You&apos;re in. The course opens on {formatCourseDate(access.startsAt)}, and your access starts then.
                      </p>
                    ) : (
                      <>
                        <div
                          role="progressbar"
                          aria-label={`${course.title} progress`}
                          aria-valuemin={0}
                          aria-valuemax={progress.available}
                          aria-valuenow={progress.completed}
                          className="h-1.5 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700"
                        >
                          <div className="h-full bg-plum-600" style={{ width: `${percent}%` }} />
                        </div>
                        <p className="mt-2 text-xs text-slate-600 dark:text-slate-400">
                          {progress.completed} of {progress.available} available {progress.available === 1 ? "lesson" : "lessons"} done
                        </p>
                        <Link data-track="courses-start-course"
                          href={href}
                          className="mt-4 inline-block rounded-lg bg-plum-600 px-4 py-2 text-sm font-medium text-white hover:bg-plum-700"
                        >
                          {ended ? "View progress" : progress.allDone ? "Review" : started ? "Continue" : "Start"}
                        </Link>
                      </>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
        </div>
      )}
    </div>
  );
}
