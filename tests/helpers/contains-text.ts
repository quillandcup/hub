/**
 * A `getByText` matcher for text that may hold links ("see the Privacy page"): Testing Library matches an element's own
 * text nodes, which a link splits. This matches the innermost paragraph, list item or cell whose whole text contains
 * `text`, so one element is found, not each of its ancestors.
 */
const BLOCKS = "p, li, td";

export function containsText(text: string) {
  return (_content: string, element: Element | null): boolean => {
    if (!element || !element.matches(BLOCKS)) return false;
    if (!(element.textContent ?? "").includes(text)) return false;
    return !Array.from(element.querySelectorAll(BLOCKS)).some((inner) => (inner.textContent ?? "").includes(text));
  };
}
