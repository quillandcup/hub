import { expect, shot, test } from "../../fixtures";

/** Screenshot for the changelog entry "privacy-page": run on demand with `pnpm changelog:capture privacy-page`. */
test("a member reads the privacy page and its usage statistics switch @changelog", async ({ page, signInAs }, testInfo) => {
  await signInAs("member");
  await page.goto("/privacy");
  await expect(page.getByRole("heading", { name: /privacy/i }).first()).toBeVisible();
  await shot(page, testInfo, "privacy");
});
