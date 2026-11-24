"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import ConfirmDialog from "@/components/ConfirmDialog";
import { lifecycleConfirm, lifecycleLabel } from "@/lib/lifecycle-actions";
import { deleteCourseItem } from "../../../outline-actions";

/**
 * Delete a Hub-owned lesson from its own page. It asks first, says what goes with it, and shows the reason inside the
 * question when the delete is refused (members have progress in it); once it is gone, the page it was on is too, so the
 * person is taken back to the course.
 */
export default function LessonDeleteButton({ courseId, lessonId, title, quiz = false }: { courseId: string; lessonId: string; title: string; quiz?: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  // A string is the reason it failed: the dialog shows it and stays open.
  const confirm = async (): Promise<string | void> => {
    try {
      const result = await deleteCourseItem(courseId, "lesson", lessonId);
      if (result.error) return result.error;
      router.push(`/admin/courses/${courseId}`);
    } catch {
      return "Something went wrong. Refresh the page and try again.";
    }
  };

  return (
    <>
      <button type="button" data-track="admin-lesson-delete-open" onClick={() => setOpen(true)} className="text-sm text-red-700 dark:text-red-300">
        {lifecycleLabel("delete", "lesson")}
      </button>
      <ConfirmDialog
        open={open}
        onClose={() => setOpen(false)}
        onConfirm={confirm}
        {...lifecycleConfirm("delete", { noun: "lesson", title, detail: quiz ? "Its text, its questions and the attempts members made go with it." : "Its text, its video link and its downloads go with it.", permanent: true })!}
      />
    </>
  );
}
