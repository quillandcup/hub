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
      <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-3xl font-bold">Courses</h1>
        <Link href="/admin/courses/new" className="rounded bg-plum-600 px-4 py-2 text-sm font-medium text-white hover:bg-plum-700">
          New course
        </Link>
      </div>
      <p className="mb-6 text-sm text-slate-600 dark:text-slate-400">
        Every course, whether it comes from Kajabi or lives in the Hub, and where it stands. Kajabi courses sync and publish from{" "}
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
              <tr key={c.id ?? c.title} className="border-b border-slate-100 last:border-0 dark:border-slate-800">
                <td className="px-4 py-3 font-medium">
                  {c.id ? (
                    <Link href={`/admin/courses/${c.id}`} className="text-plum-700 hover:underline dark:text-plum-300">
                      {c.title}
                    </Link>
                  ) : (
                    <span title="Run the Kajabi import to open this course">{c.title}</span>
                  )}
                  {c.source === "hub" && <span className="ml-2 rounded-full bg-plum-100 px-2 py-0.5 text-xs font-medium text-plum-800 dark:bg-plum-900/30 dark:text-plum-200">Hub</span>}
                </td>
                <td className="px-4 py-3">{c.isDraft ? <span className="text-slate-600 dark:text-slate-400">Draft</span> : <span>Published</span>}</td>
                <td className="px-4 py-3">
                  {c.hub ? (
                    <>
                      {accessLabel(c.hub.accessDuration)}
                      {c.hub.launchAt && <span className="block text-xs text-slate-600 dark:text-slate-400">opens {formatCourseDate(c.hub.launchAt)}</span>}
                    </>
                  ) : (
                    "–"
                  )}
                </td>
                <td className="px-4 py-3">
                  {c.totals.open} / {c.totals.coming_soon} / {c.totals.hidden}
                </td>
                <td className="px-4 py-3">{c.hub ? `${c.access.current} / ${c.access.upcoming} / ${c.access.ended}` : "–"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
