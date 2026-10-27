import AxeBuilder from "@axe-core/playwright";
import type { Page } from "playwright/test";

/**
 * Checks run on every screenshot of every scene, so each size and colour scheme gets them for free:
 *
 *  - contrast / a11y: axe (WCAG 2.0 and 2.1, levels A and AA), which includes colour contrast, so a missing
 *    dark-mode colour shows up in the dark runs;
 *  - overflow: the page scrolls sideways, or an element sticks out past the screen edge (outside a container
 *    that really scrolls sideways: a container that clips with `overflow: hidden` or `clip` is not one);
 *  - edge: a dialog, menu or popover is cut off by the screen, is taller than it with no scrolling of its own,
 *    or sits closer than EDGE_MARGIN to a side without being a full-width sheet;
 *  - covered: no control is still under a fixed or sticky bar, or any other element, after it has been scrolled to the
 *    middle of the screen (a button the user can never reach because the footer is in the way);
 *  - console: an error was logged, or the page threw (collected by the fixture, not here).
 *
 * The member app scrolls inside its own area (`main`), not the window, so before checking, every scrolling area
 * is scrolled through (`scrollThroughPage`): that lays out and loads everything below the fold, which axe needs to
 * report it consistently, and it makes lazy content appear. A full-page capture has to grow the viewport for the
 * same reason (`tallViewportHeight`): Playwright's own fullPage only knows the window.
 *
 * A finding has a stable `key` (what and where, no pixel values) so the known ones can be listed in
 * demo/baseline.json and only NEW ones fail a run. See docs/DEMO_AND_HELP.md.
 */
export const EDGE_MARGIN = 8;

export interface Finding {
  check: "a11y" | "overflow" | "edge" | "console";
  /** Stable identity: the check, the rule or kind, and a selector or message. */
  key: string;
  detail: string;
}

/** What the page-side script reports; kept as plain data so it is testable without a browser. */
export interface BoxFinding {
  kind: "page-scrolls-sideways" | "sticks-out" | "dialog-cut-off" | "dialog-too-tall" | "dialog-near-edge" | "control-covered";
  selector: string;
  detail: string;
}

/** What is known today and fails nothing: project (size and theme) -> `scene/step` -> finding keys. See demo/baseline.ts. */
export type Baseline = Record<string, Record<string, string[]>>;

/**
 * The finding keys already known for a step. A finding known at ANY size in the same theme counts as known: axe
 * isn't consistent about elements below the fold on a short screen (a stat that is reported at tablet width may
 * not be at phone width on one run and be on the next), and that is not a new problem. A genuinely new element or
 * rule isn't in any size's list, so it still fails.
 */
export function knownKeys(baseline: Baseline, project: string, step: string): Set<string> {
  const theme = project.endsWith("-dark") ? "-dark" : "-light";
  const known = new Set<string>();
  for (const [name, steps] of Object.entries(baseline)) {
    if (name.endsWith(theme)) for (const key of steps[step] ?? []) known.add(key);
  }
  return known;
}

/** A console message with urls, numbers and ids squeezed out, so the same error on another run has the same identity. */
export function consoleKey(message: string): string {
  return `console:${withoutIds(message).replace(/https?:\/\/\S+/g, "<url>").replace(/[0-9a-f]{8,}|\d+/gi, "#").slice(0, 120)}`;
}

/** The app's ids: a readable prefix, an underscore and 12 base58 characters (`prkl_gB9UBSUvB7h7`). Different on every seed. */
const APP_ID = /\b[a-z]{2,8}_[1-9A-HJ-NP-Za-km-z]{12}\b/g;

/** Replaces the app's ids in text with a placeholder, so the same finding has the same identity on every run. */
export function withoutIds(text: string): string {
  return text.replace(APP_ID, "<id>");
}

/** A selector without row positions or record ids, so a list one longer today, or a re-seeded database, has the same finding identity. */
export function stableTarget(target: string): string {
  return withoutIds(target.replace(/:nth-(?:child|of-type)\(\d+\)/g, ":nth-child(n)"));
}

export function boxFindingToFinding(f: BoxFinding): Finding {
  const check = f.kind === "page-scrolls-sideways" || f.kind === "sticks-out" ? "overflow" : "edge";
  return { check, key: `${check}:${f.kind}:${stableTarget(f.selector)}`, detail: f.detail };
}

/** Runs in the page. Scrolls every scrolling area top to bottom in screen-sized steps and back, so everything below the fold is laid out and lazy content has loaded. */
export async function scrollEverything(): Promise<number> {
  const tick = () => new Promise<void>((resolve) => requestAnimationFrame(() => setTimeout(resolve, 50)));
  const areas: HTMLElement[] = [];
  const root = document.scrollingElement as HTMLElement | null;
  if (root && root.scrollHeight > root.clientHeight + 4) areas.push(root);
  for (const el of Array.from(document.querySelectorAll<HTMLElement>("*"))) {
    if (el === root || el.clientHeight < 120 || el.scrollHeight <= el.clientHeight + 4) continue;
    if (/(auto|scroll)/.test(getComputedStyle(el).overflowY)) areas.push(el);
  }
  for (const el of areas) {
    const step = Math.max(200, Math.floor(el.clientHeight * 0.8));
    for (let y = 0; y < el.scrollHeight; y += step) {
      el.scrollTop = y;
      await tick();
    }
    el.scrollTop = el.scrollHeight;
    await tick();
    el.scrollTop = 0;
  }
  await tick();
  return areas.length;
}

/** Runs in the page. How tall the viewport must be to show the whole page: its height plus what the tallest scrolling area hides, capped. */
export function tallestViewport(cap: number): number {
  const root = document.scrollingElement as HTMLElement | null;
  let hidden = root ? Math.max(0, root.scrollHeight - root.clientHeight) : 0;
  for (const el of Array.from(document.querySelectorAll<HTMLElement>("*"))) {
    if (el === root || el.clientHeight < 120) continue;
    if (/(auto|scroll)/.test(getComputedStyle(el).overflowY)) hidden = Math.max(hidden, el.scrollHeight - el.clientHeight);
  }
  return Math.min(window.innerHeight + Math.max(0, hidden), cap);
}

/** Largest height a full-page capture will grow the viewport to: past this a page is cut, not stretched without limit. */
export const TALL_VIEWPORT_CAP = 7000;

/**
 * Screenshot the whole page, including what the page scrolls inside itself: the viewport grows to fit, the
 * screenshot is taken, the viewport goes back. Playwright's `fullPage` only grows with the window's scroll height,
 * which for an app shell that scrolls an inner area is the screen's height.
 */
export async function captureWholePage(page: Page, path: string): Promise<void> {
  const original = page.viewportSize();
  const height = await page.evaluate(tallestViewport, TALL_VIEWPORT_CAP);
  if (!original || height <= original.height + 1) {
    await page.screenshot({ path, animations: "disabled" });
    return;
  }
  await page.setViewportSize({ width: original.width, height });
  await page.waitForTimeout(250);
  try {
    await page.screenshot({ path, animations: "disabled" });
  } finally {
    await page.setViewportSize(original);
    await page.waitForTimeout(100);
  }
}

/** Runs in the page. Self-contained: no imports, no closures over Node values (it is serialised into the browser). */
export async function measureBoxes(edgeMargin: number): Promise<BoxFinding[]> {
  const out: BoxFinding[] = [];
  const vw = document.documentElement.clientWidth;
  const vh = window.innerHeight;
  const tick = () => new Promise<void>((resolve) => requestAnimationFrame(() => setTimeout(resolve, 50)));

  const selectorOf = (el: Element): string => {
    const parts: string[] = [];
    let node: Element | null = el;
    for (let depth = 0; node && depth < 4 && node !== document.body; depth++) {
      const testId = node.getAttribute("data-track") || node.getAttribute("aria-label") || node.getAttribute("role");
      const cls = (node.getAttribute("class") || "").split(/\s+/).filter((c) => c && !/[:[\]/]/.test(c)).slice(0, 2).join(".");
      parts.unshift(`${node.tagName.toLowerCase()}${testId ? `[${testId}]` : ""}${cls ? `.${cls}` : ""}`);
      node = node.parentElement;
    }
    return parts.join(" > ");
  };
  const visible = (el: Element): boolean => {
    const s = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    return s.visibility !== "hidden" && s.display !== "none" && Number(s.opacity) > 0 && r.width > 0 && r.height > 0;
  };
  // Only a container that really scrolls sideways excuses what sticks out of it. `hidden` and `clip` cut content
  // off with no way to reach it, which is the bug, not the excuse (a week calendar clipped on a phone, with the
  // scroller outside the clip seeing nothing to scroll).
  const insideScroller = (el: Element): boolean => {
    for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
      const s = getComputedStyle(p);
      if (/(auto|scroll)/.test(s.overflowX) && p.scrollWidth > p.clientWidth) return true;
    }
    return false;
  };

  // Inside a fixed panel: a slide-in drawer, closed or mid-slide. A fixed panel's own edges are the dialog check's
  // concern (and a fixed element itself is skipped below); what is drawn inside one is not "sticking out" of the page.
  const insideFixed = (el: Element): boolean => {
    for (let p: Element | null = el.parentElement; p && p !== document.body; p = p.parentElement) {
      if (getComputedStyle(p).position === "fixed") return true;
    }
    return false;
  };

  if (document.documentElement.scrollWidth > vw + 1) {
    out.push({ kind: "page-scrolls-sideways", selector: "html", detail: `the page is ${document.documentElement.scrollWidth}px wide in a ${vw}px window` });
  }

  const sticking = new Set<string>();
  for (const el of Array.from(document.body.querySelectorAll("*"))) {
    if (el.closest("[role=dialog],[role=alertdialog],[role=menu],[role=listbox],[role=tooltip]")) continue;
    if (getComputedStyle(el).position === "fixed") continue;
    if (el.closest("[inert],[aria-hidden=true]")) continue; // hidden from everyone, wherever it is drawn
    if (insideFixed(el)) continue;
    const r = el.getBoundingClientRect();
    if ((r.right > vw + 1 || r.left < -1) && visible(el) && !insideScroller(el)) {
      const sel = selectorOf(el);
      if (!sticking.has(sel) && sticking.size < 5) {
        sticking.add(sel);
        out.push({ kind: "sticks-out", selector: sel, detail: `spans ${Math.round(r.left)} to ${Math.round(r.right)}px in a ${vw}px window` });
      }
    }
  }

  for (const el of Array.from(document.querySelectorAll("[role=dialog],[role=alertdialog],[role=menu],[role=listbox],[role=tooltip]"))) {
    if (!visible(el)) continue;
    const r = el.getBoundingClientRect();
    const sel = selectorOf(el);
    if (r.left < -1 || r.right > vw + 1 || r.top < -1) {
      out.push({ kind: "dialog-cut-off", selector: sel, detail: `at ${Math.round(r.left)} to ${Math.round(r.right)}px, top ${Math.round(r.top)}px, in a ${vw}x${vh} window` });
    } else if (r.bottom > vh + 1 && !(el.scrollHeight > el.clientHeight && /(auto|scroll)/.test(getComputedStyle(el).overflowY))) {
      out.push({ kind: "dialog-too-tall", selector: sel, detail: `bottom at ${Math.round(r.bottom)}px in a ${vh}px window, and it does not scroll` });
    } else if (r.width < vw - 1 && (r.left < edgeMargin || vw - r.right < edgeMargin)) {
      out.push({ kind: "dialog-near-edge", selector: sel, detail: `${Math.round(r.left)}px from the left, ${Math.round(vw - r.right)}px from the right (wants ${edgeMargin}px)` });
    }
  }

  // Covered controls. Content passing under a fixed bar while it scrolls is normal; what matters is a control that is
  // STILL covered when it has been scrolled to the middle of the screen. That is the last item under a footer, the
  // first under a header (they can't be centred), or a bar tall enough to cover the middle. Each control is scrolled
  // to the centre and the point under it asked what is on top.
  const overlays = "[role=dialog],[role=alertdialog],[role=menu],[role=listbox],[role=tooltip],[aria-modal=true],dialog[open],[data-feedback-widget],[data-environment-indicator],nextjs-portal";
  const interactive = "a[href], button, input:not([type=hidden]), select, textarea, summary, [role=button], [role=link], [role=tab], [role=menuitem]";
  // Inside a closed <details>: not drawn, so nothing to cover (its summary is, and is still checked).
  const inClosedDisclosure = (el: Element): boolean => {
    for (let d = el.closest("details"); d; d = d.parentElement?.closest("details") ?? null) {
      const summary = el.closest("summary");
      if (!d.open && !(summary && summary.parentElement === d)) return true;
    }
    return false;
  };
  const covered = new Set<string>();
  const modalOpen = !!document.querySelector("[aria-modal=true],dialog[open]");
  if (!modalOpen) {
    for (const el of Array.from(document.querySelectorAll<HTMLElement>(interactive))) {
      if (covered.size >= 8) break;
      if ((el as HTMLButtonElement).disabled || el.getAttribute("aria-hidden") === "true" || !visible(el)) continue;
      if (el.closest(overlays) || inClosedDisclosure(el)) continue;
      const before = el.getBoundingClientRect();
      if (before.width < 4 || before.height < 4) continue;
      el.scrollIntoView({ block: "center", inline: "nearest" });
      const r = el.getBoundingClientRect();
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      if (cx < 0 || cy < 0 || cx > vw || cy > vh) continue; // hidden by a clipping container, not by an overlay
      const top = document.elementFromPoint(cx, cy);
      if (!top || el.contains(top) || top.contains(el) || top.closest(overlays)) continue;
      if (el instanceof HTMLInputElement && el.labels && Array.from(el.labels).some((l) => l === top || l.contains(top))) continue;
      const sel = selectorOf(el);
      if (covered.has(sel)) continue;
      covered.add(sel);
      out.push({ kind: "control-covered", selector: sel, detail: `even scrolled to the middle of the screen it is under ${selectorOf(top)}, so it can't be reached` });
    }
  }
  // Put every scrolling area back at the top.
  for (const el of Array.from(document.querySelectorAll<HTMLElement>("*"))) if (el.scrollTop > 0 && el.clientHeight >= 120) el.scrollTop = 0;
  if (document.scrollingElement) document.scrollingElement.scrollTop = 0;
  await tick();
  return out;
}

/** Scroll every scrolling area through, from the outside (before a screenshot or a check). */
export async function scrollThroughPage(page: Page): Promise<void> {
  await page.evaluate(scrollEverything);
}

export async function pageFindings(page: Page): Promise<Finding[]> {
  const findings: Finding[] = [];
  // Everything below the fold laid out, and lazy content loaded, before axe and the box checks look.
  await scrollThroughPage(page);

  const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  for (const v of axe.violations) {
    for (const node of v.nodes) {
      const target = stableTarget(node.target.join(" "));
      findings.push({ check: "a11y", key: `a11y:${v.id}:${target}`, detail: `${v.help} (${v.impact ?? "unknown"}): ${node.failureSummary?.split("\n")[1]?.trim() ?? ""}` });
    }
  }

  for (const f of await page.evaluate(measureBoxes, EDGE_MARGIN)) findings.push(boxFindingToFinding(f));
  return findings;
}
