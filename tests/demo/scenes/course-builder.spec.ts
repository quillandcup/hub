import { expect, shot, test } from "../fixtures";
import { DEMO_COURSE_SLUGS as SLUGS } from "../courses-seed";
import type { Page, TestInfo } from "playwright/test";

/**
 * The admin course builder at every size and colour scheme: the Outline, Details and Customers tabs of a Hub-owned
 * course, a module expanded, a row's ⋯ menu, the course header's ⋯ menu, and a lesson's editor page. A person looking
 * at a screenshot misses a title squeezed to one word a line or a menu hanging off the screen, so the layout is
 * asserted in code: nothing scrolls sideways, an opened menu lies inside the viewport, a title keeps its room, a
 * row's controls stay in the row, and the ⋯ buttons are big enough to tap on a touch screen.
 */

/** The page and the app's scrolling area (`main`) must not scroll sideways. */
async function expectNoSidewaysScroll(page: Page, what: string) {
  const { pageOverflow, mainOverflow } = await page.evaluate(() => {
    const main = document.querySelector("main");
    return { pageOverflow: document.documentElement.scrollWidth - window.innerWidth, mainOverflow: main ? main.scrollWidth - main.clientWidth : 0 };
  });
  expect(pageOverflow, `${what}: the page scrolls sideways by ${pageOverflow}px`).toBeLessThanOrEqual(1);
  expect(mainOverflow, `${what}: the content area scrolls sideways by ${mainOverflow}px`).toBeLessThanOrEqual(1);
}

/** Every open menu panel lies fully inside the viewport. */
async function expectMenusInViewport(page: Page, what: string) {
  const boxes = await page.evaluate(() =>
    [...document.querySelectorAll('[role="menu"]')]
      .map((el) => ({ name: el.getAttribute("aria-label") ?? "menu", ...el.getBoundingClientRect().toJSON(), vw: document.documentElement.clientWidth, vh: window.innerHeight }))
      .filter((b) => b.width > 0)
  );
  expect(boxes.length, `${what}: no menu is open`).toBeGreaterThan(0);
  for (const b of boxes) {
    expect(b.left, `${what}: "${b.name}" is cut off at the left (${Math.round(b.left)})`).toBeGreaterThanOrEqual(-0.5);
    expect(b.right, `${what}: "${b.name}" is cut off at the right (${Math.round(b.right)} of ${b.vw})`).toBeLessThanOrEqual(b.vw + 0.5);
    expect(b.top, `${what}: "${b.name}" is cut off at the top`).toBeGreaterThanOrEqual(-0.5);
    expect(b.bottom, `${what}: "${b.name}" is cut off at the bottom (${Math.round(b.bottom)} of ${b.vh})`).toBeLessThanOrEqual(b.vh + 0.5);
  }
}

/** A row's title keeps its room (at least 40% of the row) or at most two lines, and nothing in the row sticks out of it. */
async function expectRowsFit(page: Page, what: string) {
  const problems = await page.evaluate(() => {
    const out: string[] = [];
    const rows = [...document.querySelectorAll("main li > div.group, main li.group")] as HTMLElement[];
    for (const row of rows) {
      const r = row.getBoundingClientRect();
      if (r.width === 0) continue;
      const title = row.querySelector<HTMLElement>("span[title], a[title]");
      if (title) {
        const t = title.getBoundingClientRect();
        const lineHeight = parseFloat(getComputedStyle(title).lineHeight) || 20;
        const lines = Math.round(t.height / lineHeight);
        if (t.width < r.width * 0.4 && lines > 2) out.push(`title "${title.textContent}" is squeezed: ${Math.round(t.width)}px of a ${Math.round(r.width)}px row, ${lines} lines`);
        if (lines > 2) out.push(`title "${title.textContent}" runs to ${lines} lines`);
      }
      for (const control of row.querySelectorAll<HTMLElement>("button, a, select, input")) {
        const c = control.getBoundingClientRect();
        if (c.width === 0 || c.height === 0) continue;
        if (c.right > r.right + 1 || c.left < r.left - 1) out.push(`"${control.getAttribute("aria-label") ?? control.textContent?.trim().slice(0, 30)}" sticks out of its row (${Math.round(c.left)}-${Math.round(c.right)} vs ${Math.round(r.left)}-${Math.round(r.right)})`);
      }
    }
    return out;
  });
  expect(problems, `${what}: rows do not fit`).toEqual([]);
}

/** The ⋯ buttons are at least 36px each way where there is a finger (touch projects). */
async function expectTouchTargets(page: Page, testInfo: TestInfo, what: string) {
  if (!testInfo.project.use.hasTouch) return;
  const small = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('button[aria-haspopup="menu"][aria-label*="ctions"]')]
      .map((el) => ({ name: el.getAttribute("aria-label"), ...el.getBoundingClientRect().toJSON() }))
      .filter((b) => b.width > 0 && (b.width < 36 || b.height < 36))
      .map((b) => `${b.name} is ${Math.round(b.width)}x${Math.round(b.height)}`)
  );
  expect(small, `${what}: too small to tap`).toEqual([]);
}

async function checkPage(page: Page, testInfo: TestInfo, what: string) {
  await expectNoSidewaysScroll(page, what);
  await expectTouchTargets(page, testInfo, what);
}

/** Whether the outline is narrow enough for the ⋯ menu, as the page sees it (no quick icons visible). */
async function openRowMenu(page: Page, name: string) {
  const trigger = page.getByRole("button", { name: `Actions for ${name}` }).filter({ visible: true }).first();
  await trigger.click();
  await expect(page.getByRole("menu", { name: `Actions for ${name}` })).toBeVisible();
}

test("the admin course builder fits every size", async ({ page, signInAs }, testInfo) => {
  await signInAs("admin");
  const base = `/admin/courses/${SLUGS.current}`;

  // Outline, every module collapsed.
  await page.goto(base);
  await expect(page.locator("main").getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.getByRole("button", { name: "Expand all" })).toBeVisible();
  await checkPage(page, testInfo, "outline");
  await expectRowsFit(page, "outline, collapsed");
  await shot(page, testInfo, "outline");

  // Expanded: lessons and submodules show.
  await page.getByRole("button", { name: "Expand all" }).click();
  await expect(page.getByRole("button", { name: "Collapse all" })).toBeVisible();
  await checkPage(page, testInfo, "outline, expanded");
  await expectRowsFit(page, "outline, expanded");
  await shot(page, testInfo, "outline-expanded", { fullPage: true });

  // A module row's ⋯ menu, where the outline is narrow; the quick icons stand in for it where it is wide.
  const menuVisible = await page.getByRole("button", { name: /^Actions for / }).filter({ visible: true }).count();
  if (menuVisible > 0) {
    await openRowMenu(page, await page.getByRole("button", { name: /^Actions for / }).filter({ visible: true }).first().getAttribute("aria-label").then((l) => l!.replace("Actions for ", "")));
    await expectMenusInViewport(page, "module row menu");
    await shot(page, testInfo, "module-row-menu");
    await page.keyboard.press("Escape");
    // The last row's menu is near the bottom of the screen: it opens upward rather than off it.
    const last = page.getByRole("button", { name: /^Actions for / }).filter({ visible: true }).last();
    await last.scrollIntoViewIfNeeded();
    await last.click();
    await expectMenusInViewport(page, "last row menu");
    // No page checks here: they scroll the page, which moves this row's trigger (and the menu that follows it) off screen; the assertion above is the check.
    await shot(page, testInfo, "last-row-menu", { checks: false });
    await page.keyboard.press("Escape");
  } else {
    await expect(page.getByRole("button", { name: "Edit module" }).filter({ visible: true }).first()).toBeAttached();
  }

  // The course header's ⋯ menu.
  await page.evaluate(() => document.querySelector("main")?.scrollTo(0, 0));
  await page.getByRole("button", { name: "Course actions" }).click();
  await expectMenusInViewport(page, "course menu");
  await checkPage(page, testInfo, "course menu open");
  await shot(page, testInfo, "course-menu");
  await page.keyboard.press("Escape");

  // The other tabs.
  const tabs = page.getByRole("tab");
  for (const name of ["Details", "Customers"]) {
    const tab = tabs.filter({ hasText: name });
    if (!(await tab.count())) continue;
    await tab.first().click();
    await expect(tab.first()).toHaveAttribute("aria-selected", "true");
    await page.waitForTimeout(400);
    await checkPage(page, testInfo, `${name} tab`);
    await shot(page, testInfo, `${name.toLowerCase()}-tab`);
  }

  // A lesson's editor page, from the outline.
  await page.goto(base);
  await page.getByRole("button", { name: "Expand all" }).click();
  const lesson = page.locator(`main a[href^="/admin/courses/"][href*="/lessons/"][title]`).filter({ visible: true }).first();
  await expect(lesson).toBeVisible();
  await lesson.click();
  await expect(page.locator("main").getByRole("heading", { level: 1 })).toBeVisible();
  await page.waitForLoadState("networkidle", { timeout: 4000 }).catch(() => {});
  await checkPage(page, testInfo, "lesson editor");
  await shot(page, testInfo, "lesson-editor", { fullPage: true });
  await expectNoOffscreenControls(page, "lesson editor");
});

/** Every visible control of the page is inside the viewport's width (a clipped Save or a row of buttons running off the screen). */
async function expectNoOffscreenControls(page: Page, what: string) {
  const off = await page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    return [...document.querySelectorAll<HTMLElement>("main button, main a, main select, main input, main textarea")]
      .filter((el) => !el.closest('[role="tablist"], [class*="overflow-x-auto"]'))
      .map((el) => ({ label: el.getAttribute("aria-label") ?? el.textContent?.trim().slice(0, 30) ?? el.tagName, ...el.getBoundingClientRect().toJSON() }))
      .filter((b) => b.width > 0 && (b.right > vw + 1 || b.left < -1))
      .map((b) => `${b.label} (${Math.round(b.left)}-${Math.round(b.right)} of ${vw})`);
  });
  expect(off, `${what}: controls off screen`).toEqual([]);
}
