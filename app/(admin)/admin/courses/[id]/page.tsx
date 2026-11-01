import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdminPage } from "@/lib/admin-auth";
import { createClient } from "@/lib/supabase/server";
import { loadAdminCourse, loadAdminCourseTitle } from "@/lib/courses/admin";
import { accessLabel } from "@/lib/courses/access-options";
import { formatCourseDate, formatCourseDateTime } from "@/lib/courses/format";
import { localDateOf } from "@/lib/prickle-writing";
import { ORG_TIMEZONE } from "@/lib/config";
import { tabTitle } from "@/lib/tab-routes";
import { isId } from "@/lib/ids";
import HubCoursePage from "./HubCoursePage";
import CourseBuilderBanner from "../CourseBuilderBanner";
import CourseBuilderForm from "../CourseBuilderForm";
import CourseSettingsForm from "./CourseSettingsForm";
import CoursePublishControl from "../CoursePublishControl";
import CourseVideosPanel from "./CourseVideosPanel";
import CourseFilesPanel from "./CourseFilesPanel";

/** The tab shows the course's name first ("The Ready Writer · Courses"), like other record pages. */
export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const title = await loadAdminCourseTitle(await createClient(), id);
  return { title: tabTitle({ record: title ?? undefined, section: "Courses" }, "", true) };
}

/** The admin page for one course: the course builder (read only until it can save), filled from the latest Kajabi import. */
export default async function AdminCoursePage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdminPage();
  const { id } = await params;
  if (!isId(id, "crs")) notFound();
  const supabase = await createClient();
  // One imported from Kajabi is shown read only; a course the Hub owns is edited here.
  const detail = await loadAdminCourse(supabase, id);
  if (!detail) return <HubCoursePage id={id} />;

  const { course, explained, content, hubLessonIds, videos, files, details, lastImportedAt } = detail;
  const hub = course.hub;

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
        {hub && (
          <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm">
            <Link href={`/admin/courses/${id}/stats`} data-track="admin-course-watch-stats" className="text-plum-700 underline dark:text-plum-300">
              Watch stats
            </Link>
            <Link href={`/admin/courses/${id}/roster`} data-track="admin-course-roster" className="text-plum-700 underline dark:text-plum-300">
              Who&apos;s where
            </Link>
          </p>
        )}

        <div className="mt-6 rounded-lg bg-white p-6 shadow dark:bg-slate-900">
          <h2 className="mb-3 text-lg font-semibold">In the Hub</h2>
          {hub ? (
            <>
              <div className="mb-4">
                <CoursePublishControl courseId={id} isDraft={course.isDraft} />
              </div>
              <p className="mb-4 text-sm text-slate-600 dark:text-slate-300">
                Members open it at <code>/courses/{hub.slug}</code>. Access {accessLabel(hub.accessDuration).toLowerCase()}
                {hub.launchAt && `, opens ${formatCourseDate(hub.launchAt)}`}. {course.access.current} members have access now,{" "}
                {course.access.upcoming} start later, {course.access.ended} have ended.
              </p>
              <CourseSettingsForm
                slug={hub.slug}
                accessDuration={hub.accessDuration}
                launchOn={hub.launchAt ? localDateOf(hub.launchAt, ORG_TIMEZONE) : ""}
              />
            </>
          ) : (
            <p className="text-sm text-slate-600 dark:text-slate-300">
              Not in the Hub yet. It gets its page after the next Kajabi import from{" "}
              <Link href="/admin/data/import" className="underline">
                Import Data
              </Link>
              .
            </p>
          )}
        </div>

        <div className="mt-6">
          <CourseBuilderForm
            course={{
              id,
              title: course.title,
              slug: hub?.slug ?? null,
              description: details.description,
              accessDuration: hub ? hub.accessDuration : undefined,
              launchOn: hub?.launchAt ? localDateOf(hub.launchAt, ORG_TIMEZONE) : "",
              includesMembership: details.includesMembership,
              loose: explained.loose,
              modules: explained.modules,
              content,
              hubLessonIds,
            }}
          />
        </div>

        <CourseVideosPanel slug={hub?.slug ?? null} videos={videos} />
        <CourseFilesPanel slug={hub?.slug ?? null} plan={files} />
      </div>
    </>
  );
}
