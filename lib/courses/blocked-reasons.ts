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
