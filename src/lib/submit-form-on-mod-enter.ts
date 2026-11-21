/** What the helper needs of a key press: React's keyboard event satisfies it. */
export interface ModEnterEvent {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  defaultPrevented?: boolean;
  target: EventTarget;
  preventDefault: () => void;
  nativeEvent: { isComposing: boolean };
}

/**
 * Ctrl/Cmd+Enter submits the form the key was pressed in (`form.requestSubmit()`, so validation and the form's
 * own submit handler run as for a click on its button). Returns whether it submitted. Does nothing while an input
 * method is composing, for a key something else already handled (an editor's own Mod+Enter), outside a form, or
 * in a form marked `data-no-mod-enter-submit` (one where Enter means something else).
 *
 * Used by `Modal` (every form inside a dialog) and by the search inputs, which handle their own keys.
 */
export function submitFormOnModEnter(e: ModEnterEvent): boolean {
  if (e.key !== "Enter" || !(e.metaKey || e.ctrlKey) || e.nativeEvent.isComposing || e.defaultPrevented) return false;
  const form = e.target instanceof Element ? e.target.closest("form") : null;
  if (!form || form.hasAttribute("data-no-mod-enter-submit")) return false;
  // A disabled Save button means "not ready" (pending, or a required value missing): the key waits too.
  const submit = form.querySelector<HTMLButtonElement | HTMLInputElement>('button[type="submit"], input[type="submit"]');
  if (submit?.disabled) return false;
  e.preventDefault();
  form.requestSubmit();
  return true;
}
