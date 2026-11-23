"use client";

import { useRouter } from "next/navigation";
import ConfirmDialog from "@/components/ConfirmDialog";
import { deleteLosses, type DeletePreview } from "@/lib/courses/delete";
import { lifecycleConfirm } from "@/lib/lifecycle-actions";
import { deleteCourse } from "../delete-actions";

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * The "Delete course?" dialog (opened from the course page's actions menu): removes a Hub-owned draft course nobody uses, with
 * its modules and lessons, then goes back to the course list. The wording is the registry's (`src/lib/lifecycle-actions.ts`); the
 * detail says what goes with it and what stays. Videos and images are not deleted, since a copy may share them.
 */
export default function DeletePanel({ courseId, title, preview, open, onClose }: { courseId: string; title: string; preview: DeletePreview; open: boolean; onClose: () => void }) {
  const router = useRouter();
  const spec = lifecycleConfirm("delete", {
    noun: "course",
    title,
    permanent: true,
    detail: [`Its ${plural(preview.modules, "module")} and ${plural(preview.lessons, "lesson")} are deleted with it.`, deleteLosses(preview), "Videos and images stay in the library. This can't be undone."].filter(Boolean).join(" "),
  });
  if (!spec) return null;

  return (
    <ConfirmDialog
      {...spec}
      open={open}
      onClose={onClose}
      onConfirm={async () => {
        try {
          const result = await deleteCourse(courseId);
          if (result.error) return result.error;
        } catch {
          return "Something went wrong. Refresh the page and try again.";
        }
        router.push("/admin/courses");
      }}
    />
  );
}
