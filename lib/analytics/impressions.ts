import { getSessionId, track } from "@/lib/analytics/client";
import { templateRoute } from "@/lib/analytics/route";

const SELECTOR = "[data-track]";
const IGNORED = "[data-track-ignore]";
const STORAGE_KEY = "hub-analytics-seen";
/** Enough to hold every named control without letting a runaway page grow storage. */
const MAX_REMEMBERED = 500;

interface Remembered {
  session: string;
  names: string[];
}

function load(session: string): Set<string> {
  try {
    const stored: Remembered | null = JSON.parse(sessionStorage.getItem(STORAGE_KEY) ?? "null");
    if (stored?.session === session && Array.isArray(stored.names)) return new Set(stored.names);
  } catch {
    // Blocked storage or a bad value: start with nothing remembered.
  }
  return new Set();
}

function save(session: string, names: Set<string>): void {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ session, names: [...names].slice(-MAX_REMEMBERED) } satisfies Remembered));
  } catch {
    // Not remembered across a reload; the visit is still counted once per session in the data.
  }
}

/**
 * Records `element_seen` the first time each *named* control (`data-track="..."`) is at least half
 * on screen in a visit, so click-through has a denominator: how many visits saw a control, against
 * how many clicked it (the Least-clicked table on /admin/analytics). Only the name and the page
 * are recorded, never a label. Controls inside `data-track-ignore` are skipped. Names already seen
 * this visit are remembered in sessionStorage, so navigating or reloading doesn't repeat them.
 * Returns the function that stops it.
 */
export function startImpressions(): () => void {
  if (typeof IntersectionObserver === "undefined" || typeof MutationObserver === "undefined") return () => {};

  let session = getSessionId();
  // Null while tracking is off: nothing to record, so nothing to watch.
  if (!session) return () => {};
  let seen = load(session);

  const onSeen = (el: Element) => {
    const name = el.getAttribute("data-track");
    if (!name) return;
    const current = getSessionId();
    if (!current) return;
    if (current !== session) {
      // A new visit began (after a long idle): everything counts again.
      session = current;
      seen = load(current);
    }
    if (seen.has(name)) return;
    seen.add(name);
    save(current, seen);
    track("element_seen", { name: name.slice(0, 80), route: templateRoute(window.location.pathname) ?? "/" });
  };

  const observed = new WeakSet<Element>();
  const io = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        // A control taller than the screen can never be half visible, so half the screen counts too.
        const half = entry.rootBounds ? entry.intersectionRect.height >= entry.rootBounds.height / 2 : false;
        if (entry.isIntersecting && (entry.intersectionRatio >= 0.5 || half)) {
          io.unobserve(entry.target);
          onSeen(entry.target);
        }
      }
    },
    { threshold: [0, 0.5, 1] }
  );

  const watch = (el: Element) => {
    if (observed.has(el) || el.closest(IGNORED)) return;
    const name = el.getAttribute("data-track");
    if (!name || seen.has(name)) return;
    observed.add(el);
    io.observe(el);
  };
  const scan = (root: Element | Document) => {
    if (root instanceof Element && root.matches(SELECTOR)) watch(root);
    root.querySelectorAll(SELECTOR).forEach(watch);
  };

  scan(document);
  const mo = new MutationObserver((mutations) => {
    for (const m of mutations) {
      m.addedNodes.forEach((node) => node instanceof Element && scan(node));
      // A control renamed in place (a join link that becomes a start link).
      if (m.type === "attributes" && m.target instanceof Element) {
        observed.delete(m.target);
        io.unobserve(m.target);
        watch(m.target);
      }
    }
  });
  mo.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["data-track"] });

  return () => {
    io.disconnect();
    mo.disconnect();
  };
}
