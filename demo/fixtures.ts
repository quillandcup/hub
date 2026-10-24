import { test as base, type Page, type TestInfo } from "playwright/test";
import path from "node:path";
import { sessionCookies } from "./auth";

/**
 * `signInAs("member")` signs the page in as a demo persona and pins the theme to the project's colour scheme,
 * so the dark run is dark even if the app's stored choice is "system". `shot` saves a numbered screenshot under
 * demo/out/<scene>/<project>/.
 */
export const test = base.extend<{ signInAs: (personaKey: string) => Promise<void> }>({
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
});

export { expect } from "playwright/test";

const counters = new WeakMap<TestInfo, number>();

/** Screenshot the page as the next numbered step of the scene. */
export async function shot(page: Page, testInfo: TestInfo, name: string) {
  const n = (counters.get(testInfo) ?? 0) + 1;
  counters.set(testInfo, n);
  const scene = path.basename(testInfo.file).replace(/\.spec\.ts$/, "");
  const file = path.join("demo", "out", scene, testInfo.project.name, `${String(n).padStart(2, "0")}-${name}.png`);
  await page.screenshot({ path: file, animations: "disabled" });
}
