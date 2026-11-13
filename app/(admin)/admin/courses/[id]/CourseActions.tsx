"use client";

import { useState } from "react";
import ActionMenu, { type ActionMenuItem } from "@/components/ActionMenu";
import type { DuplicatePreview } from "@/lib/courses/duplicate";
import type { TakeOverPreview } from "@/lib/courses/take-over";
import { duplicateBlockedReason, takeOverBlockedReason } from "@/lib/courses/blocked-reasons";
import DuplicatePanel from "./DuplicatePanel";
import TakeOverPanel from "./TakeOverPanel";

/**
 * The course page's secondary actions in a ⋯ menu: duplicate, take over from Kajabi (only for a
 * course imported from Kajabi that is in the Hub), watch stats and who's where. The two that change
 * something open their confirm dialog, which says what will happen first.
 */
export default function CourseActions({
  courseId,
  title,
  duplicate,
  takeOver,
}: {
  courseId: string;
  title: string;
  /** Null when the course can't be copied (no preview). */
  duplicate: DuplicatePreview | null;
  /** Present only for a course imported from Kajabi that is in the Hub. */
  takeOver: TakeOverPreview | null;
}) {
  const [dialog, setDialog] = useState<"duplicate" | "take-over" | null>(null);
  const items: ActionMenuItem[] = [];
  if (duplicate) {
    const hint = duplicateBlockedReason(duplicate);
    items.push({ key: "duplicate", label: "Duplicate course", disabled: !!hint, hint: hint ?? undefined, track: "admin-course-duplicate-open", onSelect: () => setDialog("duplicate") });
  }
  if (takeOver) {
    const hint = takeOverBlockedReason(takeOver);
    items.push({ key: "take-over", label: "Take over from Kajabi", disabled: !!hint, hint: hint ?? undefined, track: "admin-course-take-over-open", onSelect: () => setDialog("take-over") });
  }
  items.push(
    { key: "stats", label: "Watch stats", href: `/admin/courses/${courseId}/stats`, track: "admin-course-watch-stats" },
    { key: "roster", label: "Who's where", href: `/admin/courses/${courseId}/roster`, track: "admin-course-roster" }
  );

  return (
    <>
      <ActionMenu label="Course actions" items={items} />
      {duplicate && <DuplicatePanel courseId={courseId} title={title} preview={duplicate} open={dialog === "duplicate"} onClose={() => setDialog(null)} />}
      {takeOver && <TakeOverPanel courseId={courseId} title={title} preview={takeOver} open={dialog === "take-over"} onClose={() => setDialog(null)} />}
    </>
  );
}
