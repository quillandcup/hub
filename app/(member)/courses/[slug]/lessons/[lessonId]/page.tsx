import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireCoursesPage } from "@/lib/courses/caller";
import { loadLessonView } from "@/lib/courses/member";
import { formatDuration } from "@/lib/courses/outline";
import { createMuxClient, signPlaybackTokens } from "@/lib/mux";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { isUuid } from "@/lib/chat/format";
import CourseOutline from "../../../CourseOutline";
import LessonPlayer, { type PlaybackTokens } from "../../../LessonPlayer";
import MarkCompleteButton from "../../../MarkCompleteButton";

export const metadata: Metadata = { title: "Courses" };

/** Playback tokens, only for a ready video and only after the access check has passed. */
async function mintTokens(playbackId: string): Promise<PlaybackTokens | null> {
  try {
    return await signPlaybackTokens(createMuxClient(), playbackId);
  } catch (error) {
    console.error("Couldn't mint Mux playback tokens:", error instanceof Error ? error.message : error);
    return null;
  }
}

export default async function LessonPage({ params }: { params: Promise<{ slug: string; lessonId: string }> }) {
  const { slug, lessonId } = await params;
  if (!isUuid(lessonId)) notFound();
  const caller = await requireCoursesPage();
  const result = await loadLessonView(createServiceRoleClient(), slug, lessonId, caller.scope);

  if (result.kind === "not_found") notFound();
  // Lessons that can't be opened (no access, ended access, coming soon for members) go back to the course page, which says why.
  if (result.kind !== "ok") redirect(`/courses/${slug}`);

  const { view, lesson, neighbors, completed, video, preview } = result;
  const duration = formatDuration(lesson.duration_seconds);

  let player: React.ReactNode = null;
  if (video) {
    const tokens = video.status === "ready" && video.playbackId ? await mintTokens(video.playbackId) : null;
    player =
      tokens && video.playbackId ? (
        <LessonPlayer title={lesson.title} playbackId={video.playbackId} tokens={tokens} />
      ) : (
        <p role="status" className="rounded-lg bg-slate-100 p-6 text-sm text-slate-600 dark:bg-slate-800 dark:text-slate-300">
          {video.status === "errored" ? "This video couldn't be prepared. We've been told." : "This video is still being prepared. Check back soon."}
        </p>
      );
  }

  const outline = (
    <CourseOutline slug={view.course.slug} outline={view.outline} completed={view.completed} canOpen previewComingSoon={caller.scope.isAdminActing} currentLessonId={lesson.id} />
  );

  return (
    <div className="container mx-auto max-w-6xl px-6 py-8">
      <Link href={`/courses/${view.course.slug}`} className="text-sm text-slate-500 hover:underline dark:text-slate-400">
        ← {view.course.title}
      </Link>

      <div className="mt-4 lg:grid lg:grid-cols-[18rem_1fr] lg:gap-8">
        <aside className="hidden lg:block">
          <div className="sticky top-6 max-h-[calc(100vh-3rem)] overflow-y-auto pr-2">{outline}</div>
        </aside>

        <main>
          {preview && (
            <p role="status" className="mb-4 rounded-lg bg-amber-100 p-3 text-sm text-amber-900 dark:bg-amber-900/30 dark:text-amber-200">
              Preview: members see this lesson as &ldquo;Coming soon&rdquo; until it&apos;s published in Kajabi. Progress isn&apos;t tracked here.
            </p>
          )}
          <h1 className="text-2xl font-bold">{lesson.title}</h1>
          {duration && <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{duration}</p>}

          {player && <div className="mt-4">{player}</div>}

          {lesson.body_html && (
            // Sanitized with an allowlist when it was imported (lib/courses/sanitize.ts); never stored or rendered raw.
            <div className="prose prose-slate mt-6 max-w-none dark:prose-invert" dangerouslySetInnerHTML={{ __html: lesson.body_html }} />
          )}

          <div className="mt-8 flex flex-wrap items-center justify-between gap-4 border-t border-slate-200 pt-6 dark:border-slate-800">
            {preview ? <span /> : <MarkCompleteButton lessonId={lesson.id} completed={completed} readOnly={caller.identity.isSudo} />}
            <div className="flex gap-3 text-sm">
              {neighbors.previous ? (
                <Link className="rounded-lg border border-slate-300 px-4 py-2 hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800" href={`/courses/${view.course.slug}/lessons/${neighbors.previous.id}`}>
                  ← Previous
                </Link>
              ) : null}
              {neighbors.next ? (
                <Link className="rounded-lg border border-slate-300 px-4 py-2 hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800" href={`/courses/${view.course.slug}/lessons/${neighbors.next.id}`}>
                  Next →
                </Link>
              ) : null}
            </div>
          </div>

          <details className="mt-8 rounded-lg border border-slate-200 p-4 dark:border-slate-800 lg:hidden">
            <summary className="cursor-pointer text-sm font-medium">Course outline</summary>
            <div className="mt-3">{outline}</div>
          </details>
        </main>
      </div>
    </div>
  );
}
