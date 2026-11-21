"use client";

import { useState, useTransition, type ReactNode } from "react";
import { clearMyLessonProgress } from "@/app/(member)/courses/actions";
import ActionMenu, { type ActionMenuItem } from "@/components/ActionMenu";

export interface StaffToolsProps {
  lessonId: string;
  lessonPath: string;
  /** A lesson members can't open yet, where recording is opt-in. */
  preview: boolean;
}

/**
 * Staff-only items for testing watch tracking, offered inside a lesson's Video actions menu: open a
 * preview of a lesson members can't open yet with recording on (off by default, since a preview
 * normally leaves no history), and wipe your own viewing record for the lesson to start over. The
 * clear action checks that the caller is an admin acting as themselves. `notice` is the confirmation
 * question and the result, shown under the menu.
 */
export function useStaffTools({ lessonId, lessonPath, preview }: StaffToolsProps): { items: ActionMenuItem[]; notice: ReactNode } {
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

  const items: ActionMenuItem[] = [];
  if (preview) {
    items.push({ key: "record", label: "Record my watching in this preview", href: `${lessonPath}?track=1`, track: "staff-lesson-record-toggle" });
  }
  items.push({
    key: "clear",
    label: "Clear my progress for this lesson",
    onSelect: () => {
      setResult(null);
      setConfirming(true);
    },
    track: "staff-lesson-clear-progress",
  });

  const notice = confirming ? (
    <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
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
    </div>
  ) : result ? (
    <p role="status" className="mt-2 text-xs text-slate-600 dark:text-slate-400">
      {result}
    </p>
  ) : null;

  return { items, notice };
}

/** The same items as a menu of their own, for a lesson with no video (so no Video actions menu to hold them). */
export default function LessonStaffTools(props: StaffToolsProps) {
  const { items, notice } = useStaffTools(props);
  return (
    <div className="mt-3">
      <ActionMenu label="Staff tools" items={items} />
      {notice}
    </div>
  );
}
