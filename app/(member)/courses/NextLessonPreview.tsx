"use client";

import Link from "next/link";
import { safeUrl } from "@/lib/url";
import { useLessonCompletion } from "./LessonCompletion";

/**
 * Once the lesson is complete: "Great job! Keep going!" with a preview of the next lesson (its
 * thumbnail and title) and a link on. Shows the same when the lesson was already complete on arrival.
 * With no next lesson it says so instead of leaving a dead end.
 */
export default function NextLessonPreview({ slug, next }: { slug: string; next: { id: string; title: string; thumbnail_url?: string | null } | null }) {
  const completion = useLessonCompletion();
  if (!completion?.completed) return null;

  if (!next) {
    return (
      <div role="status" className="mt-3 rounded-lg bg-slate-100 p-4 text-sm dark:bg-slate-800">
        <p className="font-semibold">Great job!</p>
        <p className="mt-1 text-slate-600 dark:text-slate-300">That&apos;s the last lesson available so far.</p>
        <Link href={`/courses/${slug}`} data-track="lesson-back-to-course" className="mt-2 inline-block font-semibold text-plum-700 hover:underline dark:text-plum-300">
          Back to the course
        </Link>
      </div>
    );
  }

  const thumbnail = safeUrl(next.thumbnail_url);
  return (
    <Link
      href={`/courses/${slug}/lessons/${next.id}`}
      data-track="lesson-next-preview"
      role="status"
      aria-label={`Great job! Keep going! Next lesson: ${next.title}`}
      className="mt-3 flex items-center gap-4 rounded-lg bg-slate-100 p-3 transition hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700"
    >
      {thumbnail ? (
        // Decorative (the title is beside it); a plain img so any Kajabi image host works.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={thumbnail} alt="" className="aspect-video w-28 shrink-0 rounded object-cover sm:w-36" />
      ) : (
        <span aria-hidden="true" className="aspect-video w-28 shrink-0 rounded bg-slate-300 dark:bg-slate-600 sm:w-36" />
      )}
      <span className="min-w-0 flex-1">
        <span className="block text-sm text-slate-600 dark:text-slate-300">Great job! Keep going!</span>
        <span className="mt-0.5 block font-semibold leading-snug">{next.title}</span>
      </span>
      <span className="shrink-0 pr-2 text-sm font-semibold text-plum-700 dark:text-plum-300">Next lesson ›</span>
    </Link>
  );
}
