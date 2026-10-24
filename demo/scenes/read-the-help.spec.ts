import { expect, shot, test } from "../fixtures";

/** The help itself: the index, an article, and its screenshots arriving through the signed-in image route. Needs `pnpm demo:publish` first. */
test("a member opens a help article and sees its screenshots", async ({ page, signInAs }, testInfo) => {
  await signInAs("member");

  await page.goto("/help");
  await expect(page.getByRole("heading", { name: "Help", level: 1 })).toBeVisible();
  await shot(page, testInfo, "help-index");

  await page.getByRole("link", { name: /How to join a prickle/ }).click();
  await expect(page.getByRole("heading", { name: "How to join a prickle", level: 1 })).toBeVisible();
  const images = page.locator("article img, main img");
  await expect(images.first()).toBeVisible();
  for (const img of await images.all()) {
    await img.scrollIntoViewIfNeeded();
    await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0)).toBe(true);
  }
  await shot(page, testInfo, "help-article");
});
