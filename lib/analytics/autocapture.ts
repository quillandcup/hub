import { track } from "@/lib/analytics/client";
import { templateRoute } from "@/lib/analytics/route";

const INTERACTIVE =
  'a[href], button, summary, [role="button"], [role="link"], [role="menuitem"], [role="tab"], input[type="submit"], input[type="button"], input[type="checkbox"], input[type="radio"], select';

/**
 * Records every click on a button, link or form control as `element_clicked`, so there is data
 * for interactions nobody thought to name. Returns the function that stops it.
 *
 * What it keeps is deliberately thin: the element kind, its `data-track` name (or `id`), the
 * route it happened on, and for an internal link the route it goes to as a template. A button's
 * label is kept (cut to 40 characters); a link's is not, since links are often a person's name
 * or a message title. Text typed into fields is never read. Put `data-track-ignore` on an element
 * (or any ancestor) to skip it entirely, and name important controls with `data-track="..."` so
 * they can be found later. A feature worth a funnel should still get its own named event.
 */
export function startAutocapture(): () => void {
  const onClick = (event: MouseEvent) => {
    const start = event.target instanceof Element ? event.target : null;
    const el = start?.closest(INTERACTIVE);
    if (!el || el.closest("[data-track-ignore]")) return;

    const tag = el.tagName.toLowerCase();
    const isButton = tag === "button" || el.getAttribute("role") === "button" || (tag === "input" && /^(submit|button)$/.test((el as HTMLInputElement).type));
    const element = tag === "a" || el.getAttribute("role") === "link" ? "link" : isButton ? "button" : tag === "input" || tag === "select" ? "input" : "other";

    const name = el.getAttribute("data-track") || el.id || undefined;
    const label = isButton ? (el.getAttribute("aria-label") ?? el.textContent ?? "").replace(/\s+/g, " ").trim() : "";

    let targetRoute: string | undefined;
    if (el instanceof HTMLAnchorElement) {
      try {
        const url = new URL(el.href, window.location.href);
        if (url.origin === window.location.origin) targetRoute = templateRoute(url.pathname) ?? undefined;
      } catch {
        // An unparseable href has no route to record.
      }
    }

    track("element_clicked", {
      element,
      route: templateRoute(window.location.pathname) ?? "/",
      ...(name ? { name: name.slice(0, 80) } : {}),
      ...(label ? { text: label.slice(0, 40) } : {}),
      ...(targetRoute ? { target_route: targetRoute } : {}),
    });
  };

  document.addEventListener("click", onClick, { capture: true, passive: true });
  return () => document.removeEventListener("click", onClick, { capture: true });
}
