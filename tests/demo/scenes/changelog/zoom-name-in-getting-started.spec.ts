import { expect, shot, test } from "../../fixtures";

/** Screenshot for changelog entry "Getting started asks for your Zoom name". Run with `pnpm changelog:capture zoom-name-in-getting-started`. */
test("a newcomer is walked to the Zoom name stop @changelog", async ({ page, signInAs }, testInfo) => {
  await signInAs("newcomer");
  await page.goto("/settings/identity");
  const stop = page.getByText(/Zoom/).first();
  await expect(stop).toBeVisible();
  await page.waitForTimeout(500);
  await shot(page, testInfo, "zoom-name-stop");
});
