import { act, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

/**
 * Helpers for tests that write in the message box, which is an editor (ProseMirror) rather than a textarea: it
 * appears after the component mounts, reads what was typed from the page asynchronously (so fast typing can lose a
 * letter, which made tests flaky under load), and its text is the element's `textContent`.
 */

/** The box, once the editor has been created. */
export const messageBox = (name?: string) => screen.findByRole("textbox", name ? { name } : undefined);

/** A user-event for typing in the box (see `typeInto`, which keeps the editor caught up). */
export const boxUser = (options: Parameters<typeof userEvent.setup>[0] = {}) => userEvent.setup({ delay: 0, ...options });

type PmView = { domObserver: { flush: () => void } };

/** Has the editor read what has been typed so far, instead of whenever it gets round to it. */
export const flushEditor = (box: HTMLElement) => {
  const editor = (box as HTMLElement & { editor?: { view?: PmView } }).editor;
  act(() => editor?.view?.domObserver.flush());
};

/** Moves the caret to the end of the text, as a browser does when a box is focused to write more. */
export const caretToEnd = async (box: HTMLElement) => {
  box.focus();
  const range = document.createRange();
  range.selectNodeContents(box);
  range.collapse(false);
  const selection = window.getSelection()!;
  selection.removeAllRanges();
  selection.addRange(range);
  // The editor learns of the new selection from the document's `selectionchange` event.
  await act(async () => {
    await new Promise((r) => setTimeout(r, 10));
  });
};

/** Types at the end of the box's text, one key at a time with the editor caught up after each (`{Enter}`-style keys are one key). */
export const typeInto = async (box: HTMLElement, text: string, user = boxUser()) => {
  await caretToEnd(box);
  for (const key of text.match(/\{[^}]+\}|[\s\S]/g) ?? []) {
    await user.keyboard(key);
    flushEditor(box);
  }
};
