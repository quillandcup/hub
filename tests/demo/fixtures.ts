import { test as base, expect, type Locator, type Page, type TestInfo } from "playwright/test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { sessionCookies } from "./auth";
import { captureWholePage, compareToBaseline, consoleKey, isEnvironmentNoise, pageFindings, pageRoute, scrollThroughPage, tally, type Baseline, type Finding, type FindingsFile } from "./checks";

/**
 * `signInAs("member")` signs the page in as a demo persona and pins the theme to the project's colour scheme,
 * so the dark run is dark even if the app's stored choice is "system". `shot` saves a numbered screenshot under
 * tests/demo/out/<scene>/<project>/ and runs the page checks (tests/demo/checks.ts) on the same state, so every scene is
 * also an accessibility, overflow and console check at every size and colour scheme.
 *
 * Every other page a test opens with `page.goto` is checked too, by the same `checkPage`: just before the next
 * `goto` leaves it (the page is still there) and when the test ends, unless a `shot` or `checkPage` already covered it.
 * A spec that opens pages needs nothing for that. `test.use({ autoPageChecks: false })` turns it off for a spec whose
 * pages aren't the app's own.
 *
 * DEMO_CHECKS: `enforce` (default) fails a step on a finding beyond what tests/demo/baseline.json lists for its page and
 * rule, `report` only writes them (tests/demo/out/.../NN-name.findings.json), `off` skips them.
 */
export const test = base.extend<{
  signInAs: (personaKey: string) => Promise<void>;
  asVisitor: () => Promise<void>;
  consoleLog: void;
  autoPageChecks: boolean;
  pageChecked: void;
}>({
  signInAs: async ({ page, context }, provide, testInfo) => {
    await provide(async (personaKey) => {
      await context.addCookies(await sessionCookies(personaKey));
      await prepareBrowser(page, testInfo);
    });
  },

  // A visitor who is not signed in: the same theme and the same hidden development furniture as `signInAs`, with no session.
  asVisitor: async ({ page, context }, provide, testInfo) => {
    await provide(async () => {
      await context.clearCookies();
      await prepareBrowser(page, testInfo);
    });
  },

  autoPageChecks: [true, { option: true }],

  // Collects what the page logs as an error or warning, or throws, with the page it happened on, so the next check can report it.
  consoleLog: [
    async ({ page }, provide) => {
      const messages: ConsoleMessage[] = [];
      consoleMessages.set(page, messages);
      const route = () => pageRoute(page.url() === "about:blank" ? "/" : page.url());
      // Chromium's own "Failed to load resource" line never says which one; the response event does.
      page.on("console", (m) => {
        const level = m.type() === "error" ? "error" : m.type() === "warning" ? "warning" : null;
        if (isEnvironmentNoise(m.text(), m.location().url)) return;
        if (level && !/^Failed to load resource/.test(m.text())) messages.push({ route: route(), level, text: m.text() });
      });
      page.on("response", (r) => {
        if (r.status() < 400) return;
        const url = new URL(r.url());
        // Vercel's analytics and speed-insights scripts exist only on Vercel's hosting; anywhere else they are a 404 that says nothing about the app.
        if (url.pathname.startsWith("/_vercel/")) return;
        if (url.origin === new URL(page.url() === "about:blank" ? r.url() : page.url()).origin) messages.push({ route: route(), level: "error", text: `HTTP ${r.status()} ${url.pathname}` });
      });
      page.on("pageerror", (e) => messages.push({ route: route(), level: "error", text: `uncaught: ${e.message}` }));
      await provide();
    },
    { auto: true },
  ],

  // A page opened with `goto` and not checked since is checked before the next `goto` leaves it, and when the test ends.
  pageChecked: [
    async ({ page, autoPageChecks }, provide, testInfo) => {
      if (!autoPageChecks) return provide();
      const goto = page.goto.bind(page);
      page.goto = (async (...args: Parameters<Page["goto"]>) => {
        await checkIfPending(page, testInfo);
        const response = await goto(...args);
        unchecked.add(page);
        return response;
      }) as Page["goto"];
      await provide();
      // The page may be closed by the test: nothing to check then.
      if (!page.isClosed()) await checkIfPending(page, testInfo);
    },
    { auto: true },
  ],
});

/** Pins the theme to the project's colour scheme and hides what is not the app's (see `signInAs`). */
async function prepareBrowser(page: Page, testInfo: TestInfo) {
  const theme = testInfo.project.use.colorScheme === "dark" ? "dark" : "light";
  await page.addInitScript((t) => window.localStorage.setItem("theme", t), theme);
  // Next's dev-mode badge, the feedback bubble and the environment label aren't what a help article or a
  // showcase is about; keep them out of screenshots.
  // A constructable stylesheet, not a <style> element: a production build's content security policy only allows nonced
  // <style> tags, so an injected one is blocked (and logged as a console error on every page). The app's policy is untouched.
  await page.addInitScript(() => {
    document.addEventListener("DOMContentLoaded", () => {
      const hide = new CSSStyleSheet();
      hide.replaceSync("nextjs-portal, [data-feedback-widget], [data-environment-indicator] { display: none !important; }");
      document.adoptedStyleSheets = [...document.adoptedStyleSheets, hide];
    });
  });
}

export { expect } from "playwright/test";

interface ConsoleMessage {
  route: string;
  level: "error" | "warning";
  text: string;
}

const consoleMessages = new WeakMap<Page, ConsoleMessage[]>();
const counters = new WeakMap<TestInfo, number>();
/** Pages opened with `goto` that no check has run on since. */
const unchecked = new WeakSet<Page>();

function loadBaseline(): Baseline {
  try {
    return JSON.parse(readFileSync(path.join("tests", "demo", "baseline.json"), "utf8")) as Baseline;
  } catch {
    return {};
  }
}

export interface ShotOptions {
  /** Crop to this element (a mockup frame) instead of the viewport. */
  element?: Locator;
  /** Run the page checks (default). Off for pages that aren't the app's own, like a mockup of a Slack message. */
  checks?: boolean;
  /**
   * Capture the whole page, including what the app scrolls inside itself (the member app scrolls `main`, not the
   * window, so Playwright's own fullPage would add nothing). The viewport grows to fit, up to a cap, then goes back.
   * For long pages and for articles that should show everything; the default is what is on the screen, as a member
   * would see it.
   */
  fullPage?: boolean;
}

/** The scene's name and the project's folder under tests/demo/out, and the next step's number. */
function nextStep(testInfo: TestInfo, name: string) {
  const n = (counters.get(testInfo) ?? 0) + 1;
  counters.set(testInfo, n);
  const scene = path.basename(testInfo.file).replace(/\.spec\.ts$/, "");
  const step = `${String(n).padStart(2, "0")}-${name}`;
  const dir = path.join("tests", "demo", "out", scene, testInfo.project.name);
  mkdirSync(dir, { recursive: true });
  return { scene, step, dir };
}

// The scroll and the checks change the page (scroll styles, injected attributes). Before React has hydrated, that
// changes attributes the server rendered, and the console then logs "a tree hydrated but some attributes of the server
// rendered HTML didn't match": a false alarm the harness caused (it looked like an app bug on /members for days). Let the
// page settle first. Best effort and capped: member pages poll, so the network may never go fully quiet.
async function settle(page: Page) {
  await page.waitForLoadState("networkidle", { timeout: 2000 }).catch(() => {});
}

/** Screenshot the page as the next numbered step of the scene, then run the page checks on that state. */
export async function shot(page: Page, testInfo: TestInfo, name: string, options: ShotOptions = {}) {
  await settle(page);
  const { scene, step, dir } = nextStep(testInfo, name);
  if (options.element) await options.element.screenshot({ path: path.join(dir, `${step}.png`), animations: "disabled" });
  else if (options.fullPage) {
    await scrollThroughPage(page); // lazy content loads as it comes into view, so it is in the picture
    await captureWholePage(page, path.join(dir, `${step}.png`));
  } else await page.screenshot({ path: path.join(dir, `${step}.png`), animations: "disabled" });

  if (options.checks === false) {
    unchecked.delete(page);
    return;
  }
  await runChecks(page, testInfo, scene, step, dir);
}

/**
 * The page checks on the page as it is, for a spec that opens pages and doesn't screenshot them (`name` says which
 * page or state in the findings file). `shot` and the automatic checks on `goto` use the same code.
 */
export async function checkPage(page: Page, testInfo: TestInfo, name: string) {
  await settle(page);
  const { scene, step, dir } = nextStep(testInfo, name);
  await runChecks(page, testInfo, scene, step, dir);
}

async function checkIfPending(page: Page, testInfo: TestInfo) {
  if (!unchecked.has(page)) return;
  unchecked.delete(page);
  const url = page.url();
  // Not the app's page (a blank tab, a mockup built in the page): nothing of the app to check.
  if (!/^https?:/.test(url) || new URL(url).origin !== new URL(testInfo.project.use.baseURL ?? process.env.DEMO_APP_URL ?? "http://localhost:3100").origin) return;
  const slug = pageRoute(url).replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "") || "home";
  await checkPage(page, testInfo, `page-${slug}`);
}

async function runChecks(page: Page, testInfo: TestInfo, scene: string, step: string, dir: string) {
  unchecked.delete(page);
  const mode = process.env.DEMO_CHECKS ?? "enforce";
  if (mode === "off") return;
  const messages = consoleMessages.get(page)?.splice(0) ?? [];
  const route = pageRoute(page.url());
  const findings: Finding[] = [
    ...(await pageFindings(page)).map((f) => ({ ...f, route })),
    ...messages.map((m) => ({ check: "console" as const, key: consoleKey(m.text, m.level), detail: m.text.slice(0, 1500), route: m.route })),
  ];
  // The pages looked at are written too, so a run knows which pages it covered and can tell a fixed finding from a page it never opened.
  const file: FindingsFile = { routes: [...new Set([route, ...findings.map((f) => f.route ?? route)])].sort(), findings };
  writeFileSync(path.join(dir, `${step}.findings.json`), JSON.stringify(file, null, 2));
  if (mode === "report") return;

  const known = loadBaseline()[testInfo.project.name] ?? {};
  const fresh = compareToBaseline(tally(findings), known);
  expect.soft(fresh, `new page problems at ${scene}/${step} (${testInfo.project.name}); fix them, or list them with \`pnpm demo:baseline\` and a reason in the PR`).toEqual([]);
}
