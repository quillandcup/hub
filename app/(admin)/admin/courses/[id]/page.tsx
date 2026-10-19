import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdminPage } from "@/lib/admin-auth";
import { createClient } from "@/lib/supabase/server";
import { loadAdminCourse } from "@/lib/courses/admin";
import { accessLabel } from "@/lib/courses/access-options";
import { formatCourseDate } from "@/lib/courses/format";
import { localDateOf } from "@/lib/prickle-writing";
import { ORG_TIMEZONE } from "@/lib/config";
import type { ExplainedLesson, ExplainedModule } from "@/lib/courses/explain";
import type { Visibility } from "@/lib/courses/visibility";
import CourseSettingsForm from "./CourseSettingsForm";

export const metadata: Metadata = { title: "Courses" };

const STATE_LABEL: Record<Visibility, string> = { open: "Open", coming_soon: "Coming soon", hidden: "Hidden" };
const STATE_STYLE: Record<Visibility, string> = {
  open: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
  coming_soon: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300",
  hidden: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300",
};

function StateBadge({ state }: { state: Visibility }) {
  return <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${STATE_STYLE[state]}`}>{STATE_LABEL[state]}</span>;
}

function LessonRow({ lesson, content }: { lesson: ExplainedLesson; content?: { hasText: boolean; hasVideo: boolean } }) {
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1 py-1.5 text-sm">
      <StateBadge state={lesson.state} />
      <span className="min-w-0 flex-1 font-medium">{lesson.title}</span>
      <span className="text-xs text-slate-500 dark:text-slate-400">{lesson.reason}</span>
      {content && (
        <span className="text-xs text-slate-500 dark:text-slate-400" title="From the Kajabi content step">
          text {content.hasText ? "✓" : "–"} · video {content.hasVideo ? "✓" : "–"}
        </span>
      )}
    </li>
  );
}

function ModuleBlock({ module, content, depth }: { module: ExplainedModule; content: Record<string, { hasText: boolean; hasVideo: boolean }>; depth: number }) {
  return (
    <section className={depth > 0 ? "ml-4 mt-3 border-l border-slate-200 pl-4 dark:border-slate-700" : "mt-6"}>
      <h3 className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm font-semibold">
        <StateBadge state={module.state} />
        <span>{module.title}</span>
        <span className="text-xs font-normal text-slate-500 dark:text-slate-400">{module.reason}</span>
      </h3>
      <ul className="mt-1 divide-y divide-slate-100 dark:divide-slate-800">
        {module.lessons.map((l) => (
          <LessonRow key={l.kajabiId} lesson={l} content={content[l.kajabiId]} />
        ))}
      </ul>
      {module.children.map((child) => (
        <ModuleBlock key={child.kajabiId} module={child} content={content} depth={depth + 1} />
      ))}
    </section>
  );
}

export default async function AdminCoursePage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdminPage();
  const { id } = await params;
  const supabase = await createClient();
  const detail = await loadAdminCourse(supabase, id);
  if (!detail) notFound();

  const { course, explained, content } = detail;

  return (
    <div className="container mx-auto max-w-5xl px-6 py-8">
      <Link href="/admin/courses" className="text-sm text-slate-500 hover:underline dark:text-slate-400">
        ← Courses
      </Link>
      <h1 className="mt-2 text-3xl font-bold">{course.title}</h1>

      <div className="mt-6 rounded-lg bg-white p-6 shadow dark:bg-slate-900">
        <h2 className="mb-3 text-lg font-semibold">In the Hub</h2>
        {course.published ? (
          <>
            <p className="mb-4 text-sm text-slate-600 dark:text-slate-300">
              Published at <code>/courses/{course.published.slug}</code>. Access {accessLabel(course.published.accessDuration).toLowerCase()}
              {course.published.launchAt && `, opens ${formatCourseDate(course.published.launchAt)}`}.{" "}
              {course.access.current} members have access now, {course.access.upcoming} start later, {course.access.ended} have ended.
            </p>
            <CourseSettingsForm
              slug={course.published.slug}
              accessDuration={course.published.accessDuration}
              launchOn={course.published.launchAt ? localDateOf(course.published.launchAt, ORG_TIMEZONE) : ""}
            />
          </>
        ) : (
          <p className="text-sm text-slate-600 dark:text-slate-300">
            Not published yet. Publish it from{" "}
            <Link href="/admin/data/import" className="underline">
              Import Data
            </Link>{" "}
            after a sync.
          </p>
        )}
      </div>

      <div className="mt-6 rounded-lg bg-white p-6 shadow dark:bg-slate-900">
        <h2 className="text-lg font-semibold">Lessons</h2>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
          {explained.totals.open} open, {explained.totals.coming_soon} coming soon, {explained.totals.hidden} hidden. A lesson is open only when it, its
          week, and every module above it are Published in Kajabi. Locked shows as coming soon; Draft is hidden. Change them in Kajabi, then sync.
        </p>

        {explained.loose.length > 0 && (
          <ul className="mt-4 divide-y divide-slate-100 dark:divide-slate-800">
            {explained.loose.map((l) => (
              <LessonRow key={l.kajabiId} lesson={l} content={content[l.kajabiId]} />
            ))}
          </ul>
        )}
        {explained.modules.map((m) => (
          <ModuleBlock key={m.kajabiId} module={m} content={content} depth={0} />
        ))}
      </div>
    </div>
  );
}
