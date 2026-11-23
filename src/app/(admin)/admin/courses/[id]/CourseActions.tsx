"use client";

import { useState } from "react";
import ActionMenu, { type ActionMenuItem } from "@/components/ActionMenu";
import type { DeletePreview } from "@/lib/courses/delete";
import type { DuplicatePreview } from "@/lib/courses/duplicate";
import type { TakeOverPreview } from "@/lib/courses/take-over";
import { deleteBlockedReason, duplicateBlockedReason, takeOverBlockedReason } from "@/lib/courses/blocked-reasons";
import { lifecycleLabel } from "@/lib/lifecycle-actions";
import DeletePanel from "./DeletePanel";
import DuplicatePanel from "./DuplicatePanel";
import TakeOverPanel from "./TakeOverPanel";

/**
 * The course page's secondary actions in a ⋯ menu: duplicate, take over from Kajabi (only for a
 * course imported from Kajabi that is in the Hub), watch stats and delete. The ones that change
 * something open their confirm dialog, which says what will happen first. Delete is always listed
 * and says why when it is off (Kajabi course, published, members using it).
 */
export default function CourseActions({
  courseId,
  title,
  duplicate,
  takeOver,
  deletion,
}: {
  courseId: string;
  title: string;
  /** Null when the course can't be copied (no preview). */
  duplicate: DuplicatePreview | null;
  /** Present only for a course imported from Kajabi that is in the Hub. */
  takeOver: TakeOverPreview | null;
  /** What deleting would remove and whether it may; null only for a course that is not there. */
  deletion: DeletePreview | null;
}) {
  const [dialog, setDialog] = useState<"duplicate" | "take-over" | "delete" | null>(null);
  const items: ActionMenuItem[] = [];
  if (duplicate) {
    const hint = duplicateBlockedReason(duplicate);
    items.push({ key: "duplicate", label: lifecycleLabel("duplicate", "course"), disabled: !!hint, hint: hint ?? undefined, track: "admin-course-duplicate-open", onSelect: () => setDialog("duplicate") });
  }
  if (takeOver) {
    const hint = takeOverBlockedReason(takeOver);
    items.push({ key: "take-over", label: "Take over from Kajabi", disabled: !!hint, hint: hint ?? undefined, track: "admin-course-take-over-open", onSelect: () => setDialog("take-over") });
  }
  items.push(
    { key: "stats", label: "Watch stats", href: `/admin/courses/${courseId}/stats`, track: "admin-course-watch-stats" }
  );
  if (deletion) {
    const hint = deleteBlockedReason(deletion);
    items.push({ key: "delete", label: lifecycleLabel("delete", "course"), disabled: !!hint, hint: hint ?? undefined, track: "admin-course-delete-open", separatorBefore: true, onSelect: () => setDialog("delete") });
  }

  return (
    <>
      <ActionMenu label="Course actions" items={items} />
      {duplicate && <DuplicatePanel courseId={courseId} title={title} preview={duplicate} open={dialog === "duplicate"} onClose={() => setDialog(null)} />}
      {takeOver && <TakeOverPanel courseId={courseId} title={title} preview={takeOver} open={dialog === "take-over"} onClose={() => setDialog(null)} />}
      {deletion && <DeletePanel courseId={courseId} title={title} preview={deletion} open={dialog === "delete"} onClose={() => setDialog(null)} />}
    </>
  );
}
