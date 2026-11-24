/** What the helper needs of a key press: React's keyboard event satisfies it. */
export interface ModEnterEvent {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  defaultPrevented?: boolean;
  target: EventTarget;
  /** The element the handler sits on (a dialog): when the key is pressed outside any form, its only form is used. */
  currentTarget?: EventTarget | null;
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
const SUBMITTABLE = "form:not([data-no-mod-enter-submit])";

/** The form the key was pressed in, or, with focus on the dialog itself, its only form (several forms: none, since it is not clear which). */
function formFor(e: ModEnterEvent): HTMLFormElement | null {
  const inside = e.target instanceof Element ? e.target.closest("form") : null;
  if (inside) return inside;
  if (!(e.currentTarget instanceof Element)) return null;
  const forms = e.currentTarget.querySelectorAll<HTMLFormElement>(SUBMITTABLE);
  return forms.length === 1 ? forms[0] : null;
}

export function submitFormOnModEnter(e: ModEnterEvent): boolean {
  if (e.key !== "Enter" || !(e.metaKey || e.ctrlKey) || e.nativeEvent.isComposing || e.defaultPrevented) return false;
  const form = formFor(e);
  if (!form || form.hasAttribute("data-no-mod-enter-submit")) return false;
  // A disabled Save button means "not ready" (pending, or a required value missing): the key waits too.
  const submit = form.querySelector<HTMLButtonElement | HTMLInputElement>('button[type="submit"], input[type="submit"]');
  if (submit?.disabled) return false;
  e.preventDefault();
  form.requestSubmit();
  return true;
}
