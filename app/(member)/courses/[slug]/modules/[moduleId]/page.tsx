import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireCoursesPage } from "@/lib/courses/caller";
import { canOpenLessons, loadCourseView } from "@/lib/courses/member";
import { moduleView, nodeLessons, type OutlineLesson, type OutlineNode } from "@/lib/courses/outline";
import { courseTitle, moduleTitles } from "@/lib/courses/page-title";
import { courseImageUrl } from "@/lib/courses/image-urls";
import { createServiceRoleClient } from "@/lib/supabase/service";
import PageBanner from "@/components/PageBanner";
import { createRepos } from "@/lib/data/repos";

export async function generateMetadata({ params }: { params: Promise<{ slug: string; moduleId: string }> }): Promise<Metadata> {
  const { slug, moduleId } = await params;
  return { title: await courseTitle(slug, (outline) => moduleTitles(outline, moduleId)) };
}

const row = "grid grid-cols-[6rem_minmax(0,1fr)_1.5rem] items-center gap-4 rounded-lg p-2 transition";

function Thumbnail({ url }: { url: string | null | undefined }) {
  const src = courseImageUrl(url);
  // Decorative (the title is beside it); a plain img so any Kajabi image host works.
  // eslint-disable-next-line @next/next/no-img-element
  return src ? <img src={src} alt="" loading="lazy" className="aspect-video w-full rounded object-cover" /> : <span aria-hidden="true" className="aspect-video w-full rounded bg-slate-100 dark:bg-slate-800" />;
}

function Check({ done }: { done: boolean }) {
  return (
    <span aria-hidden="true" className="flex justify-end text-plum-600 dark:text-plum-400">
      {done && (
        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" data-testid="completed-check">
          <path d="M4 12.5l5.5 5.5L20 6.5" />
        </svg>
      )}
    </span>
  );
}

function LessonRow({ slug, lesson, completed, openable }: { slug: string; lesson: OutlineLesson; completed: boolean; openable: boolean }) {
  const content = (
    <>
      <Thumbnail url={lesson.thumbnail_url} />
      <span className="font-medium leading-snug">
        {lesson.title}
        {completed && (
          <>
            {" "}
            <span className="sr-only">(completed)</span>
          </>
        )}
      </span>
      <Check done={completed} />
    </>
  );
  if (!openable) return <li className={`${row} opacity-50`}>{content}</li>;
  return (
    <li>
      <Link data-track="course-module-open-lesson" href={`/courses/${slug}/lessons/${lesson.id}`} className={`${row} hover:bg-slate-50 dark:hover:bg-slate-800`}>
        {content}
      </Link>
    </li>
  );
}

function ModuleRow({ slug, node, completed, openable }: { slug: string; node: OutlineNode; completed: Set<string>; openable: boolean }) {
  const lessons = nodeLessons(node).filter((l) => l.state === "open");
  const done = lessons.filter((l) => completed.has(l.id)).length;
  const first = nodeLessons(node).find((l) => l.thumbnail_url);
  const content = (
    <>
      <Thumbnail url={first?.thumbnail_url} />
      <span>
        <span className="block font-medium leading-snug">{node.module.title}</span>
        <span className="mt-1 block text-sm text-slate-600 dark:text-slate-400">
          {done} of {lessons.length} {lessons.length === 1 ? "lesson" : "lessons"} done
        </span>
      </span>
      <Check done={lessons.length > 0 && done === lessons.length} />
    </>
  );
  if (!openable) return <li className={`${row} opacity-50`}>{content}</li>;
  return (
    <li>
      <Link data-track="course-module-open-module" href={`/courses/${slug}/modules/${node.module.id}`} className={`${row} hover:bg-slate-50 dark:hover:bg-slate-800`}>
        {content}
      </Link>
    </li>
  );
}

/** One module (a month, a week): its nested modules and lessons, as Kajabi's module page lists them. */
export default async function ModulePage({ params }: { params: Promise<{ slug: string; moduleId: string }> }) {
  const { slug, moduleId } = await params;
  const caller = await requireCoursesPage();
  const view = await loadCourseView(createRepos(createServiceRoleClient()), slug, caller.scope);
  if (!view) notFound();
  // Without access to open lessons, the course page says why.
  if (!view.outline || !canOpenLessons(view.access)) redirect(`/courses/${slug}`);

  const found = moduleView(view.outline, moduleId);
  if (!found) notFound();
  const { node, trail } = found;
  const preview = node.module.state !== "open";
  // Members can't see a module that isn't released; staff previewing can.
  if (preview && !caller.scope.isAdminActing) redirect(`/courses/${slug}`);

  const lessons = nodeLessons(node).filter((l) => l.state === "open");
  const done = lessons.filter((l) => view.completed.has(l.id)).length;

  return (
    <>
      {preview && (
        <PageBanner>
          {node.module.state === "hidden"
            ? "Draft: this module is a draft, so members can't see it at all."
            : "Preview: members can't see this module until it's published."}
        </PageBanner>
      )}
      <div className="@container mx-auto w-full max-w-4xl px-6 py-6">
        <nav aria-label="Breadcrumb" className="text-sm text-slate-600 dark:text-slate-400">
          <ol className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <li>
              <Link data-track="course-module-breadcrumb-course" href={`/courses/${slug}`} className="hover:underline">
                {view.course.title}
              </Link>
            </li>
            {trail.slice(0, -1).map((crumb) => (
              <li key={crumb.id} className="flex gap-2">
                <span aria-hidden="true">/</span>
                <Link data-track="course-module-breadcrumb-module" href={`/courses/${slug}/modules/${crumb.id}`} className="hover:underline">
                  {crumb.title}
                </Link>
              </li>
            ))}
            <li aria-current="page" className="flex gap-2 text-slate-900 dark:text-slate-100">
              <span aria-hidden="true">/</span>
              <span>{node.module.title}</span>
            </li>
          </ol>
        </nav>

        <section className="mt-4 rounded-xl border border-slate-200 bg-white p-6 @pair:p-8 dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-baseline justify-between gap-4">
            <h1 className="text-3xl font-bold leading-tight">{node.module.title}</h1>
            <span className="shrink-0 text-sm text-slate-600 dark:text-slate-400">
              {done} of {lessons.length} {lessons.length === 1 ? "lesson" : "lessons"} done
            </span>
          </div>
          <ul className="mt-6 space-y-2">
            {node.children.map((child) => (
              <ModuleRow key={child.module.id} slug={slug} node={child} completed={view.completed} openable={child.module.state === "open" || caller.scope.isAdminActing} />
            ))}
            {node.lessons.map((lesson) => (
              <LessonRow
                key={lesson.id}
                slug={slug}
                lesson={lesson}
                completed={view.completed.has(lesson.id)}
                openable={lesson.state === "open" || caller.scope.isAdminActing}
              />
            ))}
          </ul>
        </section>
      </div>
    </>
  );
}
