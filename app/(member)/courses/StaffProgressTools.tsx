"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { clearMyLessonProgress } from "./actions";

/**
 * Staff-only controls under the video, for testing watch tracking: turn recording on for a preview of
 * a lesson members can't open yet (off by default, since a preview normally leaves no history), and
 * wipe your own viewing record for the lesson to start over. Only rendered for staff acting as
 * themselves; the clear action checks that again.
 */
export default function StaffProgressTools({
  lessonId,
  lessonPath,
  preview,
  recording,
}: {
  lessonId: string;
  lessonPath: string;
  /** A lesson members can't open yet, where recording is opt-in. */
  preview: boolean;
  recording: boolean;
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
      setResult(`Cleared ${outcome.segments ?? 0} watch segments and your progress. Reloading…`);
      // The player and completion state live in the browser, so reload to start from a clean lesson.
      window.location.reload();
    });

  return (
    <div className="mt-3 rounded-lg border border-dashed border-slate-300 p-3 text-sm dark:border-slate-700" aria-label="Staff tools">
      <p className="font-medium text-slate-700 dark:text-slate-300">Staff tools (only you see this)</p>
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2">
        {preview && (
          <Link
            href={recording ? lessonPath : `${lessonPath}?track=1`}
            data-track="staff-lesson-record-toggle"
            className="text-plum-700 underline hover:text-plum-800 dark:text-plum-300"
          >
            {recording ? "Stop recording my watching" : "Record my watching in this preview"}
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
        <p role="status" className="mt-2 text-slate-600 dark:text-slate-400">
          {result}
        </p>
      )}
    </div>
  );
}
