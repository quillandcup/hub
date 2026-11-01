"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { clearMyLessonProgress } from "@/app/(member)/courses/actions";

/**
 * Staff-only controls on a lesson of the admin course page, for testing watch tracking: open a
 * preview of a lesson members can't open yet with recording on (off by default, since a preview
 * normally leaves no history), and wipe your own viewing record for the lesson to start over. The
 * clear action checks that the caller is an admin acting as themselves.
 */
export default function StaffProgressTools({
  lessonId,
  lessonPath,
  preview,
}: {
  lessonId: string;
  lessonPath: string;
  /** A lesson members can't open yet, where recording is opt-in. */
  preview: boolean;
}) {
  const [confirming, setConfirming] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const clear = () =>
    startTransition(async () => {
      const outcome = await clearMyLessonProgress(lessonId);
      setConfirming(false);
      if (outcome.error) {
        setResult(outcome.error);
        return;
      }
      setResult(`Cleared ${outcome.segments ?? 0} watch segments and your progress.`);
    });

  return (
    <div className="basis-full pl-2 text-xs" aria-label="Staff tools">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        {preview && (
          <Link
            href={`${lessonPath}?track=1`}
            data-track="staff-lesson-record-toggle"
            className="text-plum-700 underline hover:text-plum-800 dark:text-plum-300"
          >
            Record my watching in this preview
          </Link>
        )}
        {confirming ? (
          <span className="flex items-center gap-2">
            <span>Delete your watch segments and progress for this lesson?</span>
            <button
              type="button"
              onClick={clear}
              disabled={pending}
              data-track="staff-lesson-clear-confirm"
              className="rounded bg-red-600 px-2 py-1 text-white hover:bg-red-700 disabled:opacity-50"
            >
              {pending ? "Clearing…" : "Yes, clear"}
            </button>
            <button type="button" onClick={() => setConfirming(false)} disabled={pending} className="underline">
              Cancel
            </button>
          </span>
        ) : (
          <button
            type="button"
            onClick={() => setConfirming(true)}
            data-track="staff-lesson-clear-progress"
            className="text-plum-700 underline hover:text-plum-800 dark:text-plum-300"
          >
            Clear my progress for this lesson
          </button>
        )}
      </div>
      {result && (
        <p role="status" className="mt-1 text-slate-600 dark:text-slate-400">
          {result}
        </p>
      )}
    </div>
  );
}
