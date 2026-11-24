import Link from "next/link";
import { notFound } from "next/navigation";
import { Tabs } from "@/components/Tabs";
import { resolveCourseParam } from "@/lib/courses/course-param";
import { clock } from "@/lib/clock";
import { createRepos } from "@/lib/data/repos";
import { isId } from "@/lib/ids";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { HeldTable, ReportedTable } from "./ModerationTables";
import UnansweredTable from "./UnansweredTable";
import { COMMENT_TAB_LABELS, COMMENTS_TITLE, type CommentTabId } from "./tabs";

/**
 * A course's lesson comments for staff (docs/product/COURSES.md, "Lesson comments", admin view), as tabs by path: the questions none of the course's
 * instructors has answered at /admin/courses/<id>/comments, and the moderation queue (open reports and comments held for review) at
 * .../comments/moderation. The page that renders this has already checked the caller is an admin.
 */
export default async function CommentsPage({ idParam, tab }: { idParam: string; tab: CommentTabId }) {
  const repos = createRepos(createServiceRoleClient());
  const id = await resolveCourseParam(repos, idParam);
  if (!isId(id, "crs")) notFound();
  const course = await repos.courses.courseById(id);
  if (!course) notFound();

  const [questions, reported, held, instructors] = await Promise.all([
    repos.courseComments.unansweredQuestions(id),
    repos.courseComments.openReports(id),
    repos.courseComments.heldComments(id),
    repos.courseInstructors.forCourse(id),
  ]);
  const nowMs = clock.now();
  const basePath = `/admin/courses/${idParam}/comments`;

  const empty = "p-3 text-sm text-slate-600 dark:text-slate-300";
  return (
    <div className="container mx-auto max-w-5xl px-6 py-8">
      <Link href={`/admin/courses/${idParam}`} className="text-sm text-slate-600 hover:underline dark:text-slate-400">
        ← {course.title}
      </Link>
      <h1 className="mt-2 text-3xl font-bold">{COMMENTS_TITLE}</h1>
      <Tabs
        key={tab}
        initialTab={tab}
        basePath={basePath}
        pageTitle={{ record: course.title, section: COMMENTS_TITLE }}
        className="mt-4"
        tabs={[
          {
            id: "unanswered",
            label: COMMENT_TAB_LABELS.unanswered,
            content: (
              <div>
                <p className="text-sm text-slate-600 dark:text-slate-300">
                  Comments on {course.title} lessons with no reply from one of the course&apos;s instructors yet, oldest first. Answer on the lesson page itself; open one to see its thread. Mark a question handled when it needs no answer.
                </p>
                {instructors.length === 0 && (
                  <p role="note" className="mt-3 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-100">
                    This course has no instructors, so no reply counts as an answer yet.{" "}
                    <Link href={`/admin/courses/${idParam}/details`} className="underline">
                      Add instructors in the course settings
                    </Link>
                    .
                  </p>
                )}
                <div className="mt-6 rounded-lg bg-white p-3 shadow dark:bg-slate-900">
                  {questions.length === 0 ? (
                    <p className={empty}>Nothing waiting. Every question on this course has an answer.</p>
                  ) : (
                    <UnansweredTable rows={questions} courseId={course.id} courseSlug={course.slug} nowMs={nowMs} />
                  )}
                </div>
              </div>
            ),
          },
          {
            id: "moderation",
            label: COMMENT_TAB_LABELS.moderation,
            content: (
              <div className="space-y-8">
                <section aria-labelledby="reported-heading">
                  <h2 id="reported-heading" className="text-lg font-semibold">
                    Reported comments ({reported.length})
                  </h2>
                  <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
                    Members&apos; reports, most reported first. Hiding or deleting a comment settles its reports; dismiss them to leave it as it is. The reporters are not named and the author is not told.
                  </p>
                  <div className="mt-3 rounded-lg bg-white p-3 shadow dark:bg-slate-900">
                    {reported.length === 0 ? (
                      <p className={empty}>No open reports.</p>
                    ) : (
                      <ReportedTable rows={reported} courseId={course.id} courseSlug={course.slug} nowMs={nowMs} />
                    )}
                  </div>
                </section>
                <section aria-labelledby="held-heading">
                  <h2 id="held-heading" className="text-lg font-semibold">
                    Held for review ({held.length})
                  </h2>
                  <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
                    Comments with more than two links wait here. Only their author and staff can see them until you approve them.
                  </p>
                  <div className="mt-3 rounded-lg bg-white p-3 shadow dark:bg-slate-900">
                    {held.length === 0 ? (
                      <p className={empty}>Nothing held.</p>
                    ) : (
                      <HeldTable rows={held} courseId={course.id} courseSlug={course.slug} nowMs={nowMs} />
                    )}
                  </div>
                </section>
              </div>
            ),
          },
        ]}
      />
    </div>
  );
}
