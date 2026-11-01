import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createRepos } from "@/lib/data/repos";
import { loadHubCourse, loadHubOutline } from "@/lib/courses/admin";
import { ACCESS_OPTIONS, accessLabel } from "@/lib/courses/access-options";
import { formatCourseDate } from "@/lib/courses/format";
import { localDateOf } from "@/lib/prickle-writing";
import { ORG_TIMEZONE } from "@/lib/config";
import BuilderOutline from "../BuilderOutline";
import CoursePublishControl from "../CoursePublishControl";
import CourseDetailsForm from "../CourseDetailsForm";

/** The admin page of a course the Hub owns (not one imported from Kajabi): its details, editable. */
export default async function HubCoursePage({ id }: { id: string }) {
  const supabase = await createClient();
  const [course, programs, outline] = await Promise.all([loadHubCourse(supabase, id), createRepos(supabase).programs.names(), loadHubOutline(supabase, id)]);
  if (!course) notFound();

  const accessIndex = ACCESS_OPTIONS.findIndex((o) => accessLabel(o.value) === accessLabel(course.accessDuration));
  return (
    <div className="@container container mx-auto max-w-5xl px-6 py-8">
      <Link href="/admin/courses" className="text-sm text-slate-600 hover:underline dark:text-slate-400">
        ← Courses
      </Link>
      <h1 className="mt-2 text-3xl font-bold">{course.title}</h1>
      <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
        A course that lives in the Hub. Members open it at <code>/courses/{course.slug}</code>; {course.access.current} have access now, {course.access.upcoming} start later,{" "}
        {course.access.ended} have ended
        {course.launchAt && `. It opens ${formatCourseDate(course.launchAt)}`}.
      </p>

      <div className="mt-4">
        <CoursePublishControl courseId={course.id} isDraft={course.isDraft} />
      </div>

      <div className="mt-6 max-w-3xl">
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
        <h2 className="mb-4 text-lg font-semibold">Outline</h2>
        {/* A Hub-owned lesson is its own Hub lesson, so its preview link takes its own id. */}
        <BuilderOutline course={{ id: course.id, slug: course.slug, editable: true, ...outline, hubLessonIds: Object.fromEntries(Object.keys(outline.content).map((lessonId) => [lessonId, lessonId])) }} />
      </div>
    </div>
  );
}
