"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  approveHeldLessonComment,
  deleteLessonCommentAsStaff,
  dismissLessonCommentReports,
  hideLessonComment,
  markLessonCommentHandled,
  type ModerationResult,
} from "@/app/(admin)/admin/courses/comment-moderation-actions";
import { track } from "@/lib/analytics/client";

export type ModerationButton = "hide" | "delete" | "dismiss" | "approve" | "handle";

const BUTTONS: Record<ModerationButton, { label: string; done: string; run: (courseId: string, commentId: string) => Promise<ModerationResult> }> = {
  hide: { label: "Hide", done: "Hidden", run: hideLessonComment },
  delete: { label: "Delete", done: "Deleted", run: deleteLessonCommentAsStaff },
  dismiss: { label: "Dismiss", done: "Reports dismissed", run: dismissLessonCommentReports },
  approve: { label: "Approve", done: "Approved", run: approveHeldLessonComment },
  handle: { label: "Mark handled", done: "Marked handled", run: markLessonCommentHandled },
};

const button =
  "rounded-lg px-2.5 py-1 text-sm font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-plum-500 disabled:cursor-not-allowed disabled:opacity-50";

/** The moderation buttons for one comment; Delete asks first. Each runs the staff action, then refreshes the list. */
export default function ModerationButtons({
  courseId,
  commentId,
  buttons,
  from,
}: {
  courseId: string;
  commentId: string;
  buttons: ModerationButton[];
  from: "unanswered" | "reported" | "held";
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function run(kind: ModerationButton) {
    setError(null);
    startTransition(async () => {
      const result = await BUTTONS[kind].run(courseId, commentId);
      if (result.error) return setError(result.error);
      setConfirming(false);
      setMessage(result.changed === false ? "Already done" : BUTTONS[kind].done);
      track("lesson_comment_moderated", { course_id: courseId, action: kind, from });
      router.refresh();
    });
  }

  return (
    <div>
      <div className="flex flex-wrap gap-1">
        {buttons.map((kind) =>
          kind === "delete" && confirming ? (
            <span key={kind} className="flex gap-1">
              <button type="button" onClick={() => run("delete")} disabled={pending} className={`${button} text-red-700 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950`}>
                Yes, delete
              </button>
              <button type="button" onClick={() => setConfirming(false)} className={`${button} text-slate-700 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800`}>
                Keep it
              </button>
            </span>
          ) : (
            <button
              key={kind}
              type="button"
              disabled={pending}
              onClick={() => (kind === "delete" ? setConfirming(true) : run(kind))}
              className={`${button} text-slate-700 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800`}
            >
              {BUTTONS[kind].label}
            </button>
          ),
        )}
      </div>
      <p role="status" aria-live="polite" className="text-xs text-slate-600 dark:text-slate-400">
        {message}
      </p>
      {error && (
        <p role="alert" className="text-xs text-red-700 dark:text-red-400">
          {error}
        </p>
      )}
    </div>
  );
}
