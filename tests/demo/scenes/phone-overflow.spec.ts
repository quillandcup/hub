import { expect, test } from "../fixtures";
import type { Page } from "playwright/test";

/**
 * Nothing on a key page may be wider than a phone: the page and the app's scrolling area (`main`) must not
 * scroll sideways, on any tab. The admin member page once scrolled into blank space because an invisible
 * tooltip box hung off an icon near the right edge. Phone project only (390px): that is where a stray wide
 * box shows. A container that scrolls sideways by design (a wide table in its own `overflow-x-auto` box) is
 * fine: only what sticks out of the page itself counts. This adds no screenshots and no axe run, so it needs no
 * baseline entries.
 */
async function expectNoSidewaysScroll(page: Page, what: string) {
  const { overflow, offenders } = await page.evaluate(() => {
    const width = window.innerWidth;
    const main = document.querySelector("main");
    const overflow = {
      page: document.documentElement.scrollWidth - width,
      main: main ? main.scrollWidth - main.clientWidth : 0,
    };
    const offenders: string[] = [];
    for (const el of document.querySelectorAll("body *")) {
      const box = el.getBoundingClientRect();
      if (box.width === 0 || box.right <= width + 1) continue;
      // Skip what a sideways-scrolling ancestor (inside the screen) holds.
      let clipped = false;
      for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
        const style = getComputedStyle(a);
        if (/(auto|scroll|hidden|clip)/.test(style.overflowX) && a.getBoundingClientRect().right <= width + 1 && a.tagName !== "MAIN") {
          clipped = true;
          break;
        }
        if (style.position === "fixed" || style.display === "none") {
          clipped = true;
          break;
        }
      }
      if (!clipped) offenders.push(`${el.tagName.toLowerCase()}.${String(el.className).slice(0, 60)} right=${Math.round(box.right)}`);
    }
    // Fall back to the widest boxes when every wide one sits inside a clipping ancestor (the scroll width still counts them).
    if (!offenders.length) {
      const widest = [...document.querySelectorAll("main *")]
        .filter((el) => !el.closest('[role="tablist"]'))
        .map((el) => ({ el, right: el.getBoundingClientRect().right }))
        .filter((x) => x.right > width + 1)
        .sort((a, b) => b.right - a.right)
        .slice(0, 3);
      for (const { el, right } of widest) {
        const chain: string[] = [];
        for (let a: Element | null = el; a && a.tagName !== "MAIN"; a = a.parentElement) {
          chain.push(`${a.tagName.toLowerCase()}[${getComputedStyle(a).overflowX}/${getComputedStyle(a).position}]`);
        }
        offenders.push(`${String(el.className).slice(0, 50)} right=${Math.round(right)} via ${chain.slice(0, 6).join("<")}`);
      }
    }
    return { overflow, offenders: offenders.slice(0, 5) };
  });
  expect(overflow.page, `${what}: the page scrolls sideways (by ${overflow.page}px). Wide elements: ${offenders.join(" | ")}`).toBeLessThanOrEqual(1);
  expect(overflow.main, `${what}: the content area scrolls sideways (by ${overflow.main}px). Wide elements: ${offenders.join(" | ")}`).toBeLessThanOrEqual(1);
}

/** goto, again when a page's own client-side navigation aborts it (the previous page was still settling). */
async function visit(page: Page, path: string) {
  for (let attempt = 1; ; attempt++) {
    try {
      await page.goto(path);
      break;
    } catch (error) {
      if (attempt >= 3 || !/ERR_ABORTED/.test(String(error))) throw error;
      await page.waitForTimeout(1000);
    }
  }
  await page.waitForLoadState("load");
}

test.beforeEach(({}, testInfo) => {
  test.skip(!testInfo.project.name.startsWith("phone"), "checked at phone width only");
});

test("admin pages fit a phone, the member page on every tab", async ({ page, signInAs }) => {
  await signInAs("admin");

  await visit(page, "/admin/members");
  await expect(page.getByRole("heading").first()).toBeVisible();
  await expectNoSidewaysScroll(page, "/admin/members");

  const href = await page.locator('main a[href^="/admin/members/"]').first().getAttribute("href");
  await visit(page, href!);
  await expect(page.getByRole("tablist")).toBeVisible();
  const tabs = page.getByRole("tab");
  const count = await tabs.count();
  expect(count).toBeGreaterThan(1);
  for (let i = 0; i < count; i++) {
    const tab = tabs.nth(i);
    const name = (await tab.innerText()).trim();
    await tab.click();
    await page.waitForTimeout(500);
    await expectNoSidewaysScroll(page, `admin member page, tab "${name}"`);
  }
});

test("member pages fit a phone", async ({ page, signInAs }) => {
  await signInAs("member");
  for (const path of ["/dashboard", "/settings", "/settings/notifications", "/my-prickles", "/my-prickles/all"]) {
    await visit(page, path);
    await expect(page.locator("main").first()).toBeVisible();
    await expectNoSidewaysScroll(page, path);
  }
});
