/**
 * Keeps Tab inside a dialog (the Exit popup's window). Plain DOM, called from the dialog's own `onKeyDown`, so it acts only while
 * focus is in the dialog: it is an element-level handler, not a page-wide shortcut.
 */

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** The things in `box` that Tab can reach, in order. */
const focusStops = (box: HTMLElement): HTMLElement[] => [...box.querySelectorAll<HTMLElement>(FOCUSABLE)];

/**
 * Tab on the last stop goes to the first, Shift+Tab on the first (or on the box itself) goes to the last, and a box with nothing
 * in it keeps the focus. Anything in between, and any other key, is left to the browser. Returns whether it took the key.
 */
export function trapTab(event: { key: string; shiftKey: boolean; preventDefault: () => void }, box: HTMLElement): boolean {
  if (event.key !== "Tab") return false;
  const stops = focusStops(box);
  if (stops.length === 0) {
    event.preventDefault();
    box.focus();
    return true;
  }
  const first = stops[0];
  const last = stops[stops.length - 1];
  const active = document.activeElement;
  if (!box.contains(active) || (event.shiftKey && (active === first || active === box))) {
    event.preventDefault();
    (event.shiftKey ? last : first).focus();
    return true;
  }
  if (!event.shiftKey && active === last) {
    event.preventDefault();
    first.focus();
    return true;
  }
  return false;
}
