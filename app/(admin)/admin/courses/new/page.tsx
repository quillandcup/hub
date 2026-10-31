import type { Metadata } from "next";
import Link from "next/link";
import { requireAdminPage } from "@/lib/admin-auth";
import { createClient } from "@/lib/supabase/server";
import { createRepos } from "@/lib/data/repos";
import CourseDetailsForm from "../CourseDetailsForm";

export const metadata: Metadata = { title: "New course · Courses" };

export default async function NewCoursePage() {
  await requireAdminPage();
  const programs = await createRepos(await createClient()).programs.names();

  return (
    <div className="@container container mx-auto max-w-3xl px-6 py-8">
      <Link href="/admin/courses" className="text-sm text-slate-600 hover:underline dark:text-slate-400">
        ← Courses
      </Link>
      <h1 className="mb-2 mt-2 text-3xl font-bold">New course</h1>
      <p className="mb-6 text-sm text-slate-600 dark:text-slate-300">
        A course that lives in the Hub, not Kajabi. Create it, then add its modules and lessons.
      </p>
      <CourseDetailsForm initial={{ title: "", slug: "", description: "", accessChoice: "", launchOn: "", programId: "" }} programs={programs} />
    </div>
  );
}
