import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createRepos } from "@/lib/data/repos";
import { loadHubCourse } from "@/lib/courses/admin";
import { ACCESS_OPTIONS, accessLabel } from "@/lib/courses/access-options";
import { formatCourseDate } from "@/lib/courses/format";
import { localDateOf } from "@/lib/prickle-writing";
import { ORG_TIMEZONE } from "@/lib/config";
import CourseDetailsForm from "../CourseDetailsForm";

/** The admin page of a course the Hub owns (not one imported from Kajabi): its details, editable. */
export default async function HubCoursePage({ id }: { id: string }) {
  const supabase = await createClient();
  const [course, programs] = await Promise.all([loadHubCourse(supabase, id), createRepos(supabase).programs.names()]);
  if (!course) notFound();

  const accessIndex = ACCESS_OPTIONS.findIndex((o) => accessLabel(o.value) === accessLabel(course.accessDuration));
  return (
    <div className="@container container mx-auto max-w-3xl px-6 py-8">
      <Link href="/admin/courses" className="text-sm text-slate-600 hover:underline dark:text-slate-400">
        ← Courses
      </Link>
      <h1 className="mt-2 text-3xl font-bold">{course.title}</h1>
      <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
        A course that lives in the Hub. Members open it at <code>/courses/{course.slug}</code>; {course.access.current} have access now, {course.access.upcoming} start later,{" "}
        {course.access.ended} have ended
        {course.launchAt && `. It opens ${formatCourseDate(course.launchAt)}`}.
      </p>

      <div className="mt-6">
        <CourseDetailsForm
          courseId={course.id}
          initial={{
            title: course.title,
            slug: course.slug,
            description: course.description ?? "",
            accessChoice: accessIndex === -1 ? "" : String(accessIndex),
            launchOn: course.launchAt ? localDateOf(course.launchAt, ORG_TIMEZONE) : "",
            programId: course.programId ?? "",
          }}
          programs={programs}
        />
      </div>

      <div className="mt-6 rounded-lg bg-white p-6 shadow dark:bg-slate-900">
        <h2 className="text-lg font-semibold">Outline</h2>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">Modules and lessons can&apos;t be added here yet.</p>
      </div>
    </div>
  );
}
