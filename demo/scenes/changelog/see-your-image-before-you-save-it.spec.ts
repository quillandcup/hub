import { expect, shot, test } from "../../fixtures";

/** Screenshot for "See your image before you save it": the image editor's previews after choosing the important part. */
test("an admin marks the important part and the previews change @changelog", async ({ page, signInAs }, testInfo) => {
  await signInAs("admin");
  await page.goto("/admin/media");
  await page.locator('[data-track="media-library-open"]').first().click();
  await page.locator("dialog img, [role=dialog] img").first().click({ position: { x: 40, y: 40 } });
  const looks = page.getByText("How it looks");
  await looks.scrollIntoViewIfNeeded();
  await expect(page.getByText(/not saved yet/).first()).toBeVisible();
  await page.getByText(/Book cover \(not saved yet\)/).scrollIntoViewIfNeeded();
  await shot(page, testInfo, "previews");
});
