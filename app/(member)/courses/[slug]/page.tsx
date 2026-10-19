import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireCoursesPage } from "@/lib/courses/caller";
import { canOpenLessons, loadCourseView } from "@/lib/courses/member";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { SUPPORT_EMAIL } from "@/lib/config";
import CourseOutline from "../CourseOutline";
import { formatCourseDate } from "@/lib/courses/format";

export const metadata: Metadata = { title: "Courses" };

export default async function CoursePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const caller = await requireCoursesPage();
  const view = await loadCourseView(createServiceRoleClient(), slug, caller.scope);
  if (!view) notFound();

  const { course, access, outline, completed, progress } = view;

  // A friendly page, not a 404: someone who just bought it, or was linked to it, needs to know what to do.
  if (!outline || !progress) {
    return (
      <div className="container mx-auto max-w-2xl px-6 py-8">
        <h1 className="mb-2 text-3xl font-bold">{course.title}</h1>
        <div className="mt-6 rounded-lg border border-slate-200 bg-white p-6 text-sm text-slate-700 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300">
          <p className="font-medium">You don&apos;t have access to this course yet.</p>
          <p className="mt-2">
            If you&apos;ve just bought it, it can take a little while to show up here. If it&apos;s been a day or more, or you think you
            should already have it, email <a className="underline" href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a> and we&apos;ll sort it out.
          </p>
          <Link href="/courses" className="mt-4 inline-block underline">
            Back to your courses
          </Link>
        </div>
      </div>
    );
  }

  const canOpen = canOpenLessons(access);
  const started = progress.completed > 0;
  const percent = progress.available > 0 ? Math.round((progress.completed / progress.available) * 100) : 0;

  return (
    <div className="container mx-auto max-w-3xl px-6 py-8">
      <Link href="/courses" className="text-sm text-slate-500 hover:underline dark:text-slate-400">
        ← Courses
      </Link>
      <h1 className="mt-2 text-3xl font-bold">{course.title}</h1>
      {course.description && <p className="mt-2 text-slate-600 dark:text-slate-300">{course.description}</p>}

      {access.kind === "ended" && (
        <p role="status" className="mt-4 rounded-lg bg-slate-100 p-4 text-sm text-slate-700 dark:bg-slate-800 dark:text-slate-200">
          Your access ended on {formatCourseDate(access.endsAt)}. Your progress is saved below, but the lessons are closed.
        </p>
      )}
      {access.kind === "open" && access.endsAt && (
        <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">Your access runs until {formatCourseDate(access.endsAt)}.</p>
      )}

      <div className="mt-6">
        <div
          role="progressbar"
          aria-label="Course progress"
          aria-valuemin={0}
          aria-valuemax={progress.available}
          aria-valuenow={progress.completed}
          className="h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800"
        >
          <div className="h-full bg-plum-600" style={{ width: `${percent}%` }} />
        </div>
        <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
          {progress.completed} of {progress.available} available {progress.available === 1 ? "lesson" : "lessons"} done
        </p>
        {canOpen && progress.continueLessonId && (
          <Link
            href={`/courses/${course.slug}/lessons/${progress.continueLessonId}`}
            className="mt-4 inline-block rounded-lg bg-plum-600 px-4 py-2 text-sm font-medium text-white hover:bg-plum-700"
          >
            {progress.allDone ? "Review" : started ? "Continue" : "Start"}
          </Link>
        )}
      </div>

      <div className="mt-8">
        <CourseOutline slug={course.slug} outline={outline} completed={completed} canOpen={canOpen} />
      </div>
    </div>
  );
}
