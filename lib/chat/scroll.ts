/** The element that scrolls the page: the layout's own scroller if there is one, else the document. */
export function scrollParent(el: HTMLElement | null): HTMLElement {
  for (let p = el?.parentElement; p; p = p.parentElement) {
    if (/(auto|scroll)/.test(getComputedStyle(p).overflowY)) return p;
  }
  return (document.scrollingElement ?? document.documentElement) as HTMLElement;
}

/** The message id (`m-<uuid>`) a link's #hash points at, or null. */
export const hashMessageId = (): string | null => /^#(m-[\w-]+)$/.exec(window.location.hash)?.[1] ?? null;

/**
 * Scrolls to (and briefly highlights) the message the URL's #hash names, leaving room above it for
 * the sticky day marker. False when the URL names none or it is not on the page (yet).
 */
export function scrollToHashMessage(from: HTMLElement | null): boolean {
  const id = hashMessageId();
  const el = id ? document.getElementById(id) : null;
  if (!el) return false;
  const scroller = scrollParent(from);
  scroller.scrollTop += el.getBoundingClientRect().top - scroller.getBoundingClientRect().top - 56;
  el.animate?.([{ backgroundColor: "rgba(168, 85, 247, 0.25)" }, { backgroundColor: "transparent" }], { duration: 2500 });
  return true;
}
