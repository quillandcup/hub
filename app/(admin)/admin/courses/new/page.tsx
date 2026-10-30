import type { Metadata } from "next";
import Link from "next/link";
import { requireAdminPage } from "@/lib/admin-auth";
import CourseBuilderBanner from "../CourseBuilderBanner";
import CourseBuilderForm from "../CourseBuilderForm";

export const metadata: Metadata = { title: "New course · Courses" };

export default async function NewCoursePage() {
  await requireAdminPage();

  return (
    <>
      <CourseBuilderBanner />
      <div className="@container container mx-auto max-w-5xl px-6 py-8">
        <Link href="/admin/courses" className="text-sm text-slate-600 hover:underline dark:text-slate-400">
          ← Courses
        </Link>
        <h1 className="mb-6 mt-2 text-3xl font-bold">New course</h1>
        <CourseBuilderForm />
      </div>
    </>
  );
}
