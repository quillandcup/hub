/** Shared guards for single-key shortcuts (j, k, [, ], p, n, t ...), so every page answers them in the same situations. */

/** Input types that are controls, not text entry: a focused checkbox or button is not "typing". */
const NON_TEXT_INPUT_TYPES = new Set(["checkbox", "radio", "button", "submit", "reset", "range", "color", "file", "image"]);

/** True while the user is typing: a text box, textarea, select or contenteditable has focus. */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  if (target instanceof HTMLInputElement) return !NON_TEXT_INPUT_TYPES.has(target.type);
  return target.tagName === "TEXTAREA" || target.tagName === "SELECT";
}

/** An element that answers Enter and Space itself, so a page shortcut must leave those keys to it. */
export function isNativeKeyTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return Boolean(target.closest('a[href], button, summary, input, select, textarea, [role="button"], [role="link"], [role="checkbox"], [role="menuitem"], [role="option"]'));
}

const OVERLAY_SELECTOR = '[role="dialog"], [role="alertdialog"], [aria-modal="true"], dialog[open], [role="menu"], [role="combobox"][aria-expanded="true"]';

/** True while a modal, dialog, menu or open combobox is on screen: page shortcuts stay out of its way. */
export function isOverlayOpen(root: ParentNode = document): boolean {
  return root.querySelector(OVERLAY_SELECTOR) !== null;
}

/** Ctrl, Cmd or Alt is held: that is a browser or app shortcut, not a single-key one. */
export function hasCommandModifier(event: Pick<KeyboardEvent, "ctrlKey" | "metaKey" | "altKey">): boolean {
  return event.ctrlKey || event.metaKey || event.altKey;
}
