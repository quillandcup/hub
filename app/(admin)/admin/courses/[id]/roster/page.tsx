import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdminPage } from "@/lib/admin-auth";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { loadCourseRoster } from "@/lib/courses/roster-data";
import RosterTable from "./RosterTable";

export const metadata: Metadata = { title: "Who's where · Courses" };

export default async function CourseRosterPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdminPage();
  const { id } = await params;
  const data = await loadCourseRoster(createServiceRoleClient(), id);
  if (!data) notFound();

  return (
    <div className="container mx-auto max-w-5xl px-6 py-8">
      <Link href={`/admin/courses/${id}`} className="text-sm text-slate-600 hover:underline dark:text-slate-400">
        ← {data.course.title}
      </Link>
      <h1 className="mt-2 text-3xl font-bold">Who&apos;s where</h1>
      <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
        Everyone with access to {data.course.title}, how many open lessons they have completed and where they last were.{" "}
        <Link href={`/admin/courses/${id}/stats`} className="text-plum-700 underline dark:text-plum-300">Watch stats</Link>
      </p>
      <div className="mt-6 rounded-lg bg-white p-4 shadow dark:bg-slate-900">
        {data.rows.length === 0 ? <p className="text-sm text-slate-600 dark:text-slate-300">Nobody has access yet.</p> : <RosterTable rows={data.rows} />}
      </div>
    </div>
  );
}
