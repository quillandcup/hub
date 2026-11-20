import type { ConfirmSpec } from "@/components/ConfirmDialog";
import type { IconName } from "@/components/Icon";

/**
 * The lifecycle of something staff author and members see (a landing page, a course, a lesson): publish it, take it down,
 * copy it, delete it, throw the draft away, bring an old version back. The same action has the same icon, label and, where it
 * needs one, the same confirmation wherever it appears, so every list, header and menu reads from here instead of choosing its
 * own (`.claude/rules/lifecycle-actions.md`). Pictures live in `components/Icon.tsx`; the confirm dialog is
 * `components/ConfirmDialog.tsx`; `components/LifecycleButton.tsx` puts them together.
 *
 * Not every thing has every action: only a landing page keeps a draft apart from what is published, so only it has
 * `reset`, `restore` and `history`; only a template has `replaceTemplate` (replace its draft with a page). A course's "draft" is whether members can see it, and its versions don't exist.
 */
export type LifecycleAction = "publish" | "unpublish" | "duplicate" | "delete" | "reset" | "restore" | "history" | "preview" | "viewLive" | "saveAsTemplate" | "replaceTemplate";

/** What the confirmation needs to say. `noun` is "page", "course", "lesson". */
export type LifecycleContext = {
  noun: string;
  /** The thing's own name, shown quoted in a delete. */
  title?: string;
  /** What else happens, one plain sentence ("Its 3 lessons are deleted with it."). */
  detail?: string;
  /** The delete can't be recovered by anyone (say so). */
  permanent?: boolean;
};

type Entry = {
  icon: IconName;
  /** The control's name, also its tooltip and accessible name when it is an icon. */
  label: (noun: string) => string;
  /** Present when the action asks first. */
  confirm?: (context: LifecycleContext) => ConfirmSpec;
};

export const LIFECYCLE_ACTIONS: Record<LifecycleAction, Entry> = {
  publish: { icon: "publish", label: () => "Publish" },
  unpublish: {
    icon: "unpublish",
    label: () => "Unpublish",
    confirm: ({ noun, detail }) => ({
      title: `Take this ${noun} down?`,
      body: detail ?? `It stops being available at once. Nothing is deleted.`,
      confirmLabel: "Unpublish",
      tone: "danger",
    }),
  },
  duplicate: { icon: "copy", label: (noun) => `Duplicate ${noun}` },
  delete: {
    icon: "trash",
    label: (noun) => `Delete ${noun}`,
    confirm: ({ noun, title, detail, permanent }) => ({
      title: `Delete ${noun}?`,
      body: `${title ? `“${title}”` : `This ${noun}`} will be deleted${permanent ? " for good" : ""}.${detail ? ` ${detail}` : ""}`,
      confirmLabel: `Delete ${noun}`,
      tone: "danger",
    }),
  },
  reset: {
    icon: "reset",
    label: () => "Reset to published",
    confirm: ({ noun }) => ({
      title: "Reset to published?",
      body: `Your unpublished changes to this ${noun} are thrown away, and it goes back to the published ${noun}. This can't be undone.`,
      confirmLabel: "Reset to published",
      tone: "danger",
    }),
  },
  restore: {
    icon: "history",
    label: () => "Bring back",
    confirm: ({ detail }) => ({
      title: "Bring this version back?",
      body: detail ?? "It replaces your current draft. Nothing goes live until you publish.",
      confirmLabel: "Bring back",
      tone: "danger",
    }),
  },
  history: { icon: "history", label: () => "History" },
  preview: { icon: "eye", label: () => "Preview" },
  viewLive: { icon: "external", label: () => "View live" },
  // Saving a page as a template (the page builder), and replacing an existing template's draft with it (the old draft is kept in its History).
  saveAsTemplate: { icon: "template", label: () => "Save as template" },
  replaceTemplate: {
    icon: "save",
    label: () => "Replace template draft",
    confirm: ({ noun, detail }) => ({
      title: `Replace the ${noun}'s draft?`,
      body: detail ?? `The ${noun}'s current draft is kept in its History and can be brought back. Its published copy doesn't change until you publish it.`,
      confirmLabel: "Replace template draft",
      tone: "danger",
    }),
  },
};

export const lifecycleLabel = (action: LifecycleAction, noun = "") => LIFECYCLE_ACTIONS[action].label(noun);
export const lifecycleIcon = (action: LifecycleAction): IconName => LIFECYCLE_ACTIONS[action].icon;
/** The confirmation to show before the action, or null when it doesn't ask. */
export const lifecycleConfirm = (action: LifecycleAction, context: LifecycleContext): ConfirmSpec | null => LIFECYCLE_ACTIONS[action].confirm?.(context) ?? null;
