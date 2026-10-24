import { test as base, expect, type Locator, type Page, type TestInfo } from "playwright/test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { sessionCookies } from "./auth";
import { consoleKey, pageFindings, type Baseline, type Finding } from "./checks";

/**
 * `signInAs("member")` signs the page in as a demo persona and pins the theme to the project's colour scheme,
 * so the dark run is dark even if the app's stored choice is "system". `shot` saves a numbered screenshot under
 * demo/out/<scene>/<project>/ and runs the page checks (demo/checks.ts) on the same state, so every scene is
 * also an accessibility, overflow and console check at every size and colour scheme.
 *
 * DEMO_CHECKS: `enforce` (default) fails a step on a finding not listed in demo/baseline.json, `report` only
 * writes them (demo/out/.../NN-name.findings.json), `off` skips them.
 */
export const test = base.extend<{ signInAs: (personaKey: string) => Promise<void>; consoleLog: void }>({
  signInAs: async ({ page, context }, provide, testInfo) => {
    await provide(async (personaKey) => {
      await context.addCookies(await sessionCookies(personaKey));
      const theme = testInfo.project.use.colorScheme === "dark" ? "dark" : "light";
      await page.addInitScript((t) => window.localStorage.setItem("theme", t), theme);
      // Next's dev-mode badge, the feedback bubble and the environment label aren't what a help article or a
      // showcase is about; keep them out of screenshots.
      await page.addInitScript(() => {
        const hide = document.createElement("style");
        hide.textContent = "nextjs-portal, [data-feedback-widget], [data-environment-indicator] { display: none !important; }";
        document.addEventListener("DOMContentLoaded", () => document.head.appendChild(hide));
      });
    });
  },

  // Collects what the page logs as an error or throws, so the next screenshot can report it.
  consoleLog: [
    async ({ page }, provide) => {
      const errors: string[] = [];
      consoleErrors.set(page, errors);
      // Chromium's own "Failed to load resource" line never says which one; the response event does.
      page.on("console", (m) => m.type() === "error" && !/^Failed to load resource/.test(m.text()) && errors.push(m.text()));
      page.on("response", (r) => {
        if (r.status() < 400) return;
        const url = new URL(r.url());
        // Vercel's analytics and speed-insights scripts exist only on Vercel's hosting; anywhere else they are a 404 that says nothing about the app.
        if (url.pathname.startsWith("/_vercel/")) return;
        if (url.origin === new URL(page.url() === "about:blank" ? r.url() : page.url()).origin) errors.push(`HTTP ${r.status()} ${url.pathname}`);
      });
      page.on("pageerror", (e) => errors.push(`uncaught: ${e.message}`));
      await provide();
    },
    { auto: true },
  ],
});

export { expect } from "playwright/test";

const consoleErrors = new WeakMap<Page, string[]>();
const counters = new WeakMap<TestInfo, number>();

function loadBaseline(): Baseline {
  try {
    return JSON.parse(readFileSync(path.join("demo", "baseline.json"), "utf8")) as Baseline;
  } catch {
    return {};
  }
}

export interface ShotOptions {
  /** Crop to this element (a mockup frame) instead of the viewport. */
  element?: Locator;
  /** Run the page checks (default). Off for pages that aren't the app's own, like a mockup of a Slack message. */
  checks?: boolean;
}

/** Screenshot the page as the next numbered step of the scene, then run the page checks on that state. */
export async function shot(page: Page, testInfo: TestInfo, name: string, options: ShotOptions = {}) {
  const n = (counters.get(testInfo) ?? 0) + 1;
  counters.set(testInfo, n);
  const scene = path.basename(testInfo.file).replace(/\.spec\.ts$/, "");
  const step = `${String(n).padStart(2, "0")}-${name}`;
  const dir = path.join("demo", "out", scene, testInfo.project.name);
  mkdirSync(dir, { recursive: true });
  if (options.element) await options.element.screenshot({ path: path.join(dir, `${step}.png`), animations: "disabled" });
  else await page.screenshot({ path: path.join(dir, `${step}.png`), animations: "disabled" });

  const mode = process.env.DEMO_CHECKS ?? "enforce";
  if (mode === "off" || options.checks === false) return;
  const errors = consoleErrors.get(page)?.splice(0) ?? [];
  const findings: Finding[] = [
    ...(await pageFindings(page)),
    ...errors.map((m) => ({ check: "console" as const, key: consoleKey(m), detail: m.slice(0, 300) })),
  ];
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, `${step}.findings.json`), JSON.stringify(findings, null, 2));
  if (mode === "report") return;

  const known = new Set(loadBaseline()[testInfo.project.name]?.[`${scene}/${step}`] ?? []);
  const fresh = findings.filter((f) => !known.has(f.key));
  expect.soft(fresh.map((f) => `${f.key}: ${f.detail}`), `new page problems at ${scene}/${step} (${testInfo.project.name})`).toEqual([]);
}
