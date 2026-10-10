/** The element that scrolls the page: the layout's own scroller if there is one, else the document. */
export function scrollParent(el: HTMLElement | null): HTMLElement {
  for (let p = el?.parentElement; p; p = p.parentElement) {
    if (/(auto|scroll)/.test(getComputedStyle(p).overflowY)) return p;
  }
  return (document.scrollingElement ?? document.documentElement) as HTMLElement;
}
