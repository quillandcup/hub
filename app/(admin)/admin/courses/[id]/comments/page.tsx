import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdminPage } from "@/lib/admin-auth";
import { resolveCourseParam } from "@/lib/courses/course-param";
import { createRepos } from "@/lib/data/repos";
import { clock } from "@/lib/clock";
import { isId } from "@/lib/ids";
import { createServiceRoleClient } from "@/lib/supabase/service";
import UnansweredTable from "./UnansweredTable";

export const metadata: Metadata = { title: "Unanswered questions · Courses" };

/** A course's lesson comments nobody on staff has answered yet, oldest first (docs/COURSES.md, "Lesson comments", admin view). */
export default async function CourseCommentsPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdminPage();
  const { id: idParam } = await params;
  const repos = createRepos(createServiceRoleClient());
  const id = await resolveCourseParam(repos, idParam);
  if (!isId(id, "crs")) notFound();
  const course = await repos.courses.courseById(id);
  if (!course) notFound();

  const questions = await repos.courseComments.unansweredQuestions(id);

  return (
    <div className="container mx-auto max-w-5xl px-6 py-8">
      <Link href={`/admin/courses/${idParam}`} className="text-sm text-slate-600 hover:underline dark:text-slate-400">
        ← {course.title}
      </Link>
      <h1 className="mt-2 text-3xl font-bold">Unanswered questions</h1>
      <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
        Comments on {course.title} lessons with no reply from staff yet, oldest first. Answer on the lesson page itself; open one to see its thread.
      </p>
      <div className="mt-6 rounded-lg bg-white p-3 shadow dark:bg-slate-900">
        {questions.length === 0 ? (
          <p className="p-3 text-sm text-slate-600 dark:text-slate-300">Nothing waiting. Every question on this course has an answer.</p>
        ) : (
          <UnansweredTable rows={questions} courseSlug={course.slug} nowMs={clock.now()} />
        )}
      </div>
    </div>
  );
}
