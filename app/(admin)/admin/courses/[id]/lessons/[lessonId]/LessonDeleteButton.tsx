"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Modal from "@/components/Modal";
import { deleteCourseItem } from "../../../outline-actions";

/**
 * Delete a Hub-owned lesson from its own page. It asks first, says what goes with it, and shows the reason inside the
 * question when the delete is refused (members have progress in it); once it is gone, the page it was on is too, so the
 * person is taken back to the course.
 */
export default function LessonDeleteButton({ courseId, lessonId, title }: { courseId: string; lessonId: string; title: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const confirm = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await deleteCourseItem(courseId, "lesson", lessonId);
      if (result.error) setError(result.error);
      else router.push(`/admin/courses/${courseId}`);
    } catch {
      setError("Something went wrong. Refresh the page and try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button
        type="button"
        data-track="admin-lesson-delete-open"
        onClick={() => {
          setError(null);
          setOpen(true);
        }}
        className="text-sm text-red-700 dark:text-red-300"
      >
        Delete lesson
      </button>
      <Modal isOpen={open} onClose={() => !busy && setOpen(false)} title="Delete lesson?" maxWidth="md">
        <div className="p-6">
          <p className="text-sm">“{title}” will be deleted for good, with its text, its video link and its downloads.</p>
          {error && (
            <p role="alert" className="mt-3 text-sm text-red-700 dark:text-red-300">
              {error}
            </p>
          )}
          <div className="mt-6 flex justify-end gap-2">
            <button type="button" disabled={busy} onClick={() => setOpen(false)} className="rounded border border-slate-300 px-4 py-2 text-sm font-medium disabled:opacity-60 dark:border-slate-600">
              Cancel
            </button>
            <button type="button" disabled={busy} onClick={confirm} className="rounded bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50">
              {busy ? "Deleting…" : "Delete lesson"}
            </button>
          </div>
        </div>
      </Modal>
    </>
  );
}
