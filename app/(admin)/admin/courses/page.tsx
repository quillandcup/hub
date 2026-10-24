import type { Metadata } from "next";
import Link from "next/link";
import { requireAdminPage } from "@/lib/admin-auth";
import { createClient } from "@/lib/supabase/server";
import { loadAdminCourses } from "@/lib/courses/admin";
import { accessLabel } from "@/lib/courses/access-options";
import { formatCourseDate } from "@/lib/courses/format";

export const metadata: Metadata = { title: "Courses" };

export default async function AdminCoursesPage() {
  await requireAdminPage();
  const supabase = await createClient();
  const courses = await loadAdminCourses(supabase);

  return (
    <div className="container mx-auto max-w-6xl px-6 py-8">
      <h1 className="mb-2 text-3xl font-bold">Courses</h1>
      <p className="mb-6 text-sm text-slate-600 dark:text-slate-400">
        Every course in Kajabi and where it stands in the Hub. Sync and publish from{" "}
        <Link href="/admin/data/import" className="underline">
          Import Data
        </Link>
        ; open a course to see why each lesson is open, coming soon or hidden.
      </p>

      <div className="overflow-x-auto rounded-lg bg-white shadow dark:bg-slate-900">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-600 dark:border-slate-800 dark:text-slate-400">
            <tr>
              <th className="px-4 py-3">Course</th>
              <th className="px-4 py-3">In the Hub</th>
              <th className="px-4 py-3">Access</th>
              <th className="px-4 py-3">Lessons (open / coming soon / hidden)</th>
              <th className="px-4 py-3">Members (current / upcoming / ended)</th>
            </tr>
          </thead>
          <tbody>
            {courses.map((c) => (
              <tr key={c.kajabiId} className="border-b border-slate-100 last:border-0 dark:border-slate-800">
                <td className="px-4 py-3 font-medium">
                  <Link href={`/admin/courses/${c.kajabiId}`} className="text-plum-700 hover:underline dark:text-plum-300">
                    {c.title}
                  </Link>
                </td>
                <td className="px-4 py-3">{c.published ? <span>Published</span> : <span className="text-slate-600 dark:text-slate-400">Not published</span>}</td>
                <td className="px-4 py-3">
                  {c.published ? (
                    <>
                      {accessLabel(c.published.accessDuration)}
                      {c.published.launchAt && <span className="block text-xs text-slate-600 dark:text-slate-400">opens {formatCourseDate(c.published.launchAt)}</span>}
                    </>
                  ) : (
                    "–"
                  )}
                </td>
                <td className="px-4 py-3">
                  {c.totals.open} / {c.totals.coming_soon} / {c.totals.hidden}
                </td>
                <td className="px-4 py-3">{c.published ? `${c.access.current} / ${c.access.upcoming} / ${c.access.ended}` : "–"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
