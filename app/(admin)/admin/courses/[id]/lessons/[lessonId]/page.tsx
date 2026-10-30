import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdminPage } from "@/lib/admin-auth";
import { createClient } from "@/lib/supabase/server";
import { loadAdminLesson } from "@/lib/courses/admin";
import { formatCourseDateTime } from "@/lib/courses/format";
import CourseBuilderBanner from "../../../CourseBuilderBanner";
import LessonStaffTools from "../../LessonStaffTools";
import LessonBuilderForm from "./LessonBuilderForm";

type Params = { params: Promise<{ id: string; lessonId: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { id, lessonId } = await params;
  const detail = await loadAdminLesson(await createClient(), id, lessonId);
  // Most specific first: "Lesson · Course · Courses".
  return { title: [detail?.lesson.title, detail?.course.title, "Courses"].filter(Boolean).join(" · ") };
}

/** One lesson's builder page: the lesson as last imported from Kajabi, read only until the builder can save. */
export default async function AdminLessonPage({ params }: Params) {
  await requireAdminPage();
  const { id, lessonId } = await params;
  const detail = await loadAdminLesson(await createClient(), id, lessonId);
  if (!detail) notFound();
  const { course, lesson, hub } = detail;
  const path = hub ? `/courses/${hub.slug}/lessons/${hub.lessonId}` : null;

  return (
    <>
      <CourseBuilderBanner />
      <div className="@container container mx-auto max-w-6xl px-6 py-8">
        <Link href={`/admin/courses/${course.kajabiId}`} className="text-sm text-slate-600 hover:underline dark:text-slate-400">
          ← {course.title}
        </Link>
        <div className="mb-1 mt-2 flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-3xl font-bold">{lesson.title}</h1>
          <div className="flex items-center gap-2">
            {path && (
              <Link href={path} className="rounded-full border border-slate-300 px-4 py-2 text-sm font-medium dark:border-slate-600">
                Preview
              </Link>
            )}
            <button type="button" disabled className="rounded bg-plum-600 px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50">
              Save
            </button>
          </div>
        </div>
        <p className="mb-6 text-sm text-slate-600 dark:text-slate-300">Last imported from Kajabi {formatCourseDateTime(lesson.fetchedAt)}.</p>
        {hub && (
          <div className="mb-6 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg bg-white p-4 text-sm shadow dark:bg-slate-900">
            <span className="font-medium">Staff tools</span>
            <LessonStaffTools lessonId={hub.lessonId} lessonPath={path!} preview={lesson.state !== "open"} />
          </div>
        )}
        <LessonBuilderForm detail={detail} />
      </div>
    </>
  );
}
