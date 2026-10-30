/**
 * The quick status change on each row of the course builder's outline (Draft, Publish, Schedule,
 * Drip, Lock), and which of them an item may take given the modules above it. Pure.
 *
 * Kajabi's `publishing_option` is `draft`, `published`, `locked` or `drip`; Schedule is offered by
 * Kajabi's menu too but isn't in what the import stores, so it is listed and never shown as current.
 * An item can't be published while a module above it is still a draft, so Publish names the module
 * to publish first. Locked, drip and scheduled modules don't block it: Kajabi allows a published
 * week inside a locked module (the lesson is then "coming soon" in the Hub, see `explain.ts`).
 */

export interface StatusChoice {
  value: "draft" | "published" | "scheduled" | "drip" | "locked";
  /** The action in the menu ("Publish"). */
  action: string;
  /** What the pill says once it is the current status ("Published"). */
  label: string;
}

export const STATUS_CHOICES: StatusChoice[] = [
  { value: "draft", action: "Draft", label: "Draft" },
  { value: "published", action: "Publish", label: "Published" },
  { value: "scheduled", action: "Schedule", label: "Scheduled" },
  { value: "drip", action: "Drip", label: "Drip" },
  { value: "locked", action: "Lock", label: "Locked" },
];

/** The pill's text for a stored publishing option; an unrecognised or missing one is shown as what it is. */
export function statusLabel(option: string | null | undefined): string {
  return STATUS_CHOICES.find((c) => c.value === option)?.label ?? (option ? option : "No setting");
}

export interface Ancestor {
  title: string;
  publishingOption: string | null;
}

export interface AvailableChoice extends StatusChoice {
  /** Why the choice can't be taken right now; absent when it can. */
  disabledReason?: string;
}

/**
 * The menu for an item whose modules above it are `ancestors` (outermost first). The item's
 * `current` status is never blocked: it is what the menu already says, and an item that is
 * already published under a draft module (Kajabi allows it) isn't "blocked" from being what it is.
 */
export function statusChoices(ancestors: Ancestor[], current?: string | null): AvailableChoice[] {
  const blocker = [...ancestors].reverse().find((a) => !a.publishingOption || a.publishingOption === "draft");
  return STATUS_CHOICES.map((c) => (c.value === "published" && c.value !== current && blocker ? { ...c, disabledReason: `Publish “${blocker.title}” first` } : c));
}
