import { track } from "@/lib/analytics/client";
import { templateRoute } from "@/lib/analytics/route";

const INTERACTIVE =
  'a[href], button, summary, [role="button"], [role="link"], [role="menuitem"], [role="tab"], input[type="submit"], input[type="button"], input[type="checkbox"], input[type="radio"], select';

const MAX_LABEL = 40;

/** Where a label is never recorded: opted out with `data-track-no-text`, or in a table (rows of people and their data). */
const NO_LABEL_ZONE = "[data-track-no-text], table";
const EMAIL_LIKE = /\S+@\S+/;

const clean = (value: string | null | undefined) => (value ?? "").replace(/\s+/g, " ").trim();

/**
 * What a control says it is, so a click can be told apart from the next one: its `aria-label`,
 * else what a person would read. A field is named by its `<label>` (never its value, which is what
 * someone typed or picked), else its `name`; anything else by its own text. Empty when there is
 * nothing to go on.
 */
function labelOf(el: Element): string {
  const aria = clean(el.getAttribute("aria-label"));
  if (aria) return aria;
  if (el instanceof HTMLInputElement || el instanceof HTMLSelectElement) {
    return clean(el.labels?.[0]?.textContent) || clean(el.getAttribute("name"));
  }
  if (el instanceof HTMLButtonElement && el.type === "submit" && el.value && !el.textContent?.trim()) return clean(el.value);
  return clean(el.textContent);
}

/**
 * Records every click on a button, link or form control as `element_clicked`, so there is data
 * for interactions nobody thought to name. Returns the function that stops it.
 *
 * What it keeps is deliberately thin: the element kind, its `data-track` name (or `id`), a label
 * (cut to 40 characters), the route it happened on, and for an internal link the route it goes to
 * as a template. A label is a guess at "text the UI defines", and a control that shows a person's
 * name or email would leak it, so a label is left out when:
 *   - the link goes to a record page (`/members/[id]`, `/prickles/[id]`...): that text is a name or a title;
 *   - the page is in the admin area, which is full of member data;
 *   - the control is inside a table, or inside anything marked `data-track-no-text`
 *     (put it on any control that shows who is signed in, or other people);
 *   - it looks like an email address.
 * Text typed into fields, and a field's value, are never read. Put `data-track-ignore` on an element
 * (or any ancestor) to skip the click entirely, and name important controls with `data-track="..."`
 * so they can be found when their label is left out. A feature worth a funnel should still get its
 * own named event.
 */
export function startAutocapture(): () => void {
  const onClick = (event: MouseEvent) => {
    const start = event.target instanceof Element ? event.target : null;
    const el = start?.closest(INTERACTIVE);
    if (!el || el.closest("[data-track-ignore]")) return;

    const tag = el.tagName.toLowerCase();
    const isButton = tag === "button" || el.getAttribute("role") === "button" || (tag === "input" && /^(submit|button)$/.test((el as HTMLInputElement).type));
    const isLink = tag === "a" || el.getAttribute("role") === "link";
    const element = isLink ? "link" : isButton ? "button" : tag === "input" || tag === "select" ? "input" : "other";

    const name = el.getAttribute("data-track") || el.id || undefined;

    let targetRoute: string | undefined;
    if (el instanceof HTMLAnchorElement) {
      try {
        const url = new URL(el.href, window.location.href);
        if (url.origin === window.location.origin) targetRoute = templateRoute(url.pathname) ?? undefined;
      } catch {
        // An unparseable href has no route to record.
      }
    }

    const route = templateRoute(window.location.pathname) ?? "/";
    const pointsAtRecord = targetRoute?.includes("[id]") ?? false;
    const labelAllowed = !pointsAtRecord && !(route === "/admin" || route.startsWith("/admin/")) && !el.closest(NO_LABEL_ZONE);
    const found = labelAllowed ? labelOf(el) : "";
    const label = EMAIL_LIKE.test(found) ? "" : found;

    track("element_clicked", {
      element,
      route,
      ...(name ? { name: name.slice(0, 80) } : {}),
      ...(label ? { text: label.slice(0, MAX_LABEL) } : {}),
      ...(targetRoute ? { target_route: targetRoute } : {}),
    });
  };

  document.addEventListener("click", onClick, { capture: true, passive: true });
  return () => document.removeEventListener("click", onClick, { capture: true });
}
