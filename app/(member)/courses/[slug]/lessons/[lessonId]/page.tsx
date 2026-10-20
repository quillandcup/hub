import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireCoursesPage } from "@/lib/courses/caller";
import { loadLessonView } from "@/lib/courses/member";
import { formatDuration, lessonContext, type OutlineLesson } from "@/lib/courses/outline";
import { createMuxClient, signPlaybackTokens } from "@/lib/mux";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { isUuid } from "@/lib/chat/format";
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

/** The lesson before or after this one: a card with its title, so the way on is clear without an outline. */
function NeighborCard({ slug, lesson, direction }: { slug: string; lesson: OutlineLesson; direction: "previous" | "next" }) {
  return (
    <Link
      href={`/courses/${slug}/lessons/${lesson.id}`}
      className={`group block rounded-xl border border-slate-200 bg-white p-4 transition hover:border-plum-300 hover:shadow-sm dark:border-slate-800 dark:bg-slate-900 dark:hover:border-plum-700 ${
        direction === "next" ? "sm:text-right" : ""
      }`}
    >
      <span className="block text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
        {direction === "previous" ? "← Previous" : "Next →"}
      </span>
      <span className="mt-1 block font-medium group-hover:text-plum-700 dark:group-hover:text-plum-300">{lesson.title}</span>
    </Link>
  );
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

  const context = lessonContext(view.outline, lesson.id);
  const courseHref = `/courses/${view.course.slug}`;

  return (
    <div className="container mx-auto max-w-3xl px-6 py-8">
      <Link href={courseHref} className="text-sm text-slate-500 hover:underline dark:text-slate-400">
        ← {view.course.title}
      </Link>

      <main className="mt-6">
        {preview && (
          <p role="status" className="mb-6 rounded-lg bg-amber-100 p-3 text-sm text-amber-900 dark:bg-amber-900/30 dark:text-amber-200">
            Preview: members see this lesson as &ldquo;Coming soon&rdquo; until it&apos;s published in Kajabi. Progress isn&apos;t tracked here.
          </p>
        )}

        <header>
          {context && (
            <p className="text-xs font-semibold uppercase tracking-wide text-plum-700 dark:text-plum-300">
              {`${context.trail.length > 0 ? `${context.trail.join(" › ")} · ` : ""}Lesson ${context.position} of ${context.total}`}
            </p>
          )}
          <h1 className="mt-2 text-3xl font-bold leading-tight">{lesson.title}</h1>
          {duration && <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{duration}</p>}
        </header>

        {player && <div className="mt-6 overflow-hidden rounded-2xl shadow-lg ring-1 ring-black/5 dark:ring-white/10">{player}</div>}

        {lesson.body_html && (
          // Sanitized with an allowlist when it was imported (lib/courses/sanitize.ts); never stored or rendered raw.
          <div className="prose prose-slate prose-lg mt-8 max-w-none dark:prose-invert" dangerouslySetInnerHTML={{ __html: lesson.body_html }} />
        )}

        <div className="mt-10 border-t border-slate-200 pt-6 dark:border-slate-800">
          {!preview && <MarkCompleteButton lessonId={lesson.id} completed={completed} readOnly={caller.identity.isSudo} />}

          {(neighbors.previous || neighbors.next) && (
            <div className="mt-6 grid gap-3 sm:grid-cols-2">
              {neighbors.previous ? <NeighborCard slug={view.course.slug} lesson={neighbors.previous} direction="previous" /> : <span />}
              {neighbors.next ? <NeighborCard slug={view.course.slug} lesson={neighbors.next} direction="next" /> : <span />}
            </div>
          )}

          <p className="mt-8 text-center text-sm">
            <Link href={courseHref} className="text-slate-500 underline hover:text-plum-700 dark:text-slate-400 dark:hover:text-plum-300">
              View the full course outline
            </Link>
          </p>
        </div>
      </main>
    </div>
  );
}
