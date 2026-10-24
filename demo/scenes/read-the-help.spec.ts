import { expect, shot, test } from "../fixtures";

/** The help itself: the index, then every article, with its screenshots arriving through the signed-in image route. Needs `pnpm demo:publish` first. */
test("a member opens each help article and sees its screenshots", async ({ page, signInAs }, testInfo) => {
  await signInAs("member");

  // From the question mark in the top bar, as a member would.
  await page.goto("/dashboard");
  await page.getByRole("banner").getByRole("link", { name: "Help" }).click();
  await expect(page.getByRole("heading", { name: "Hedgie Help", level: 1 })).toBeVisible();
  await shot(page, testInfo, "help-index");

  const hrefs = await page.locator('main a[href^="/help/"]').evaluateAll((links) => links.map((a) => a.getAttribute("href") ?? ""));
  expect(hrefs.length).toBeGreaterThan(1);

  for (const href of hrefs) {
    await page.goto(href);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    for (const img of await page.locator("main img").all()) {
      await img.scrollIntoViewIfNeeded();
      await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0), { message: `${href}: ${await img.getAttribute("src")}` }).toBe(true);
    }
  }
  await shot(page, testInfo, "help-article");
});
