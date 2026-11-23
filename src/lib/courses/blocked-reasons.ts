import type { DeletePreview } from "@/lib/courses/delete";
import type { DuplicatePreview } from "@/lib/courses/duplicate";
import type { TakeOverPreview } from "@/lib/courses/take-over";

/** Why a course can't be copied right now, or null when it can. Shown beside the menu item. */
export function duplicateBlockedReason(preview: Pick<DuplicatePreview, "tooDeep">): string | null {
  return preview.tooDeep ? "Its modules are nested deeper than the editor handles (a module has submodules, and a submodule has lessons), so it can't be copied." : null;
}

/** Why a Kajabi course can't be taken over right now, or null when it can. */
export function takeOverBlockedReason(preview: Pick<TakeOverPreview, "tooDeep" | "lessons">): string | null {
  if (preview.tooDeep) return "Its modules are nested deeper than the editor handles (a module has submodules, and a submodule has lessons). Flatten it in Kajabi, then import again.";
  if (preview.lessons === 0) return "It has no lessons in the Hub yet. Import it from Kajabi first.";
  return null;
}

/** The access that stops a delete, with how many of each kind ("Members have access to it (2 with access, 1 with a grant)..."). */
export function membersBlockedReason(preview: Pick<DeletePreview, "access" | "grants">): string {
  const kinds = [preview.access > 0 && `${preview.access} with access`, preview.grants > 0 && `${preview.grants} with a grant`].filter(Boolean).join(", ");
  return `Members have access to it (${kinds}), so it can't be deleted.`;
}

/**
 * Why a course can't be deleted right now, or null when it can. Shown beside the menu item; the database checks the same things
 * (`delete_course`), so this is the explanation, not the guard. Progress, comments and chat links don't block: the dialog lists them.
 */
export function deleteBlockedReason(preview: Pick<DeletePreview, "source" | "isDraft" | "access" | "grants">): string | null {
  if (preview.source !== "hub") return "It comes from Kajabi, and the next import would bring it back. Remove it in Kajabi, then import again.";
  if (!preview.isDraft) return "It is published. Unpublish it first.";
  if (preview.access + preview.grants > 0) return membersBlockedReason(preview);
  return null;
}
