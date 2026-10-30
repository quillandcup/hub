import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdminPage } from "@/lib/admin-auth";
import { createClient } from "@/lib/supabase/server";
import { loadAdminCourse } from "@/lib/courses/admin";
import { accessLabel } from "@/lib/courses/access-options";
import { formatCourseDate, formatCourseDateTime } from "@/lib/courses/format";
import { localDateOf } from "@/lib/prickle-writing";
import { ORG_TIMEZONE } from "@/lib/config";
import CourseBuilderBanner from "../CourseBuilderBanner";
import CourseBuilderForm from "../CourseBuilderForm";
import CourseSettingsForm from "./CourseSettingsForm";
import CourseVideosPanel from "./CourseVideosPanel";
import CourseFilesPanel from "./CourseFilesPanel";

export const metadata: Metadata = { title: "Courses" };

/** The admin page for one course: the course builder (read only until it can save), filled from the latest Kajabi import. */
export default async function AdminCoursePage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdminPage();
  const { id } = await params;
  const supabase = await createClient();
  const detail = await loadAdminCourse(supabase, id);
  if (!detail) notFound();

  const { course, explained, content, hubLessonIds, videos, files, details, lastImportedAt } = detail;
  const published = course.published;

  return (
    <>
      <CourseBuilderBanner />
      <div className="@container container mx-auto max-w-5xl px-6 py-8">
        <Link href="/admin/courses" className="text-sm text-slate-600 hover:underline dark:text-slate-400">
          ← Courses
        </Link>
        <h1 className="mt-2 text-3xl font-bold">{course.title}</h1>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
          {lastImportedAt ? `Last imported from Kajabi ${formatCourseDateTime(lastImportedAt)}.` : "Not imported from Kajabi yet."} {explained.totals.open} lessons
          open, {explained.totals.coming_soon} coming soon, {explained.totals.hidden} hidden. A lesson is open only when it and every module above it are
          Published in Kajabi; Locked shows as coming soon and Draft is hidden from members. You can preview coming-soon lessons and drafts; members never see
          drafts.
        </p>
        {published && (
          <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm">
            <Link href={`/admin/courses/${course.kajabiId}/stats`} data-track="admin-course-watch-stats" className="text-plum-700 underline dark:text-plum-300">
              Watch stats
            </Link>
            <Link href={`/admin/courses/${course.kajabiId}/roster`} data-track="admin-course-roster" className="text-plum-700 underline dark:text-plum-300">
              Who&apos;s where
            </Link>
          </p>
        )}

        <div className="mt-6 rounded-lg bg-white p-6 shadow dark:bg-slate-900">
          <h2 className="mb-3 text-lg font-semibold">In the Hub</h2>
          {published ? (
            <>
              <p className="mb-4 text-sm text-slate-600 dark:text-slate-300">
                Published at <code>/courses/{published.slug}</code>. Access {accessLabel(published.accessDuration).toLowerCase()}
                {published.launchAt && `, opens ${formatCourseDate(published.launchAt)}`}. {course.access.current} members have access now,{" "}
                {course.access.upcoming} start later, {course.access.ended} have ended.
              </p>
              <CourseSettingsForm
                slug={published.slug}
                accessDuration={published.accessDuration}
                launchOn={published.launchAt ? localDateOf(published.launchAt, ORG_TIMEZONE) : ""}
              />
            </>
          ) : (
            <p className="text-sm text-slate-600 dark:text-slate-300">
              Not published yet. Publish it from{" "}
              <Link href="/admin/data/import" className="underline">
                Import Data
              </Link>{" "}
              after a sync.
            </p>
          )}
        </div>

        <div className="mt-6">
          <CourseBuilderForm
            course={{
              title: course.title,
              slug: published?.slug ?? null,
              description: details.description,
              accessDuration: published ? published.accessDuration : undefined,
              launchOn: published?.launchAt ? localDateOf(published.launchAt, ORG_TIMEZONE) : "",
              includesMembership: details.includesMembership,
              loose: explained.loose,
              modules: explained.modules,
              content,
              hubLessonIds,
            }}
          />
        </div>

        <CourseVideosPanel slug={published?.slug ?? null} videos={videos} />
        <CourseFilesPanel slug={published?.slug ?? null} plan={files} />
      </div>
    </>
  );
}
