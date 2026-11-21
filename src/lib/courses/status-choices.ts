/**
 * The quick status change on each row of the course builder's outline (Draft, Publish, Schedule,
 * Drip, Lock), and which of them the editor offers yet. Pure.
 *
 * Kajabi's `publishing_option` is `draft`, `published`, `locked` or `drip`; Schedule is offered by
 * Kajabi's menu too but isn't in what the import stores, so it is listed and never shown as current.
 *
 * Nothing is blocked by what is above an item: Publish can be chosen under a draft module, and the item
 * then waits (its state is limited by the module) until the module is switched on. That is the point:
 * prepare a whole section, mark every lesson in it Published, and open or close it with the section's own
 * setting. Kajabi allows it too (a Published lesson inside a Draft module). Schedule and Drip need a date
 * or a delay the Hub doesn't take yet (`docs/TODO.md`), so they are listed but not offered.
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

export interface AvailableChoice extends StatusChoice {
  /** Why the choice can't be taken right now; absent when it can. */
  disabledReason?: string;
}

const NOT_YET = "Needs a date or a delay the Hub doesn't take yet";

/**
 * The menu for an item whose current setting is `current`: every choice, with Schedule and Drip marked as not offered yet.
 */
export function statusChoices(current?: string | null): AvailableChoice[] {
  return STATUS_CHOICES.map((c) => ((c.value === "scheduled" || c.value === "drip") && c.value !== current ? { ...c, disabledReason: NOT_YET } : c));
}
