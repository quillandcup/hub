import AxeBuilder from "@axe-core/playwright";
import type { Page } from "playwright/test";

/**
 * Checks run on every screenshot of every scene, so each size and colour scheme gets them for free:
 *
 *  - contrast / a11y: axe (WCAG 2.0 and 2.1, levels A and AA), which includes colour contrast, so a missing
 *    dark-mode colour shows up in the dark runs;
 *  - overflow: the page scrolls sideways, or an element sticks out past the screen edge (outside a container
 *    that is meant to scroll);
 *  - edge: a dialog, menu or popover is cut off by the screen, is taller than it with no scrolling of its own,
 *    or sits closer than EDGE_MARGIN to a side without being a full-width sheet;
 *  - console: an error was logged, or the page threw (collected by the fixture, not here).
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
  kind: "page-scrolls-sideways" | "sticks-out" | "dialog-cut-off" | "dialog-too-tall" | "dialog-near-edge";
  selector: string;
  detail: string;
}

/** What is known today and fails nothing: project (size and theme) -> `scene/step` -> finding keys. See demo/baseline.ts. */
export type Baseline = Record<string, Record<string, string[]>>;

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

/** Runs in the page. Self-contained: no imports, no closures over Node values (it is serialised into the browser). */
export function measureBoxes(edgeMargin: number): BoxFinding[] {
  const out: BoxFinding[] = [];
  const vw = document.documentElement.clientWidth;
  const vh = window.innerHeight;

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
  const insideScroller = (el: Element): boolean => {
    for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
      const s = getComputedStyle(p);
      if (/(auto|scroll|hidden|clip)/.test(s.overflowX) && p.scrollWidth > p.clientWidth) return true;
      if (/(auto|scroll|hidden|clip)/.test(s.overflowX)) return true;
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
  return out;
}

export async function pageFindings(page: Page): Promise<Finding[]> {
  const findings: Finding[] = [];

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
