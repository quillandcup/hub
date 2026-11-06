import { expect, shot, test } from "../../fixtures";

/** Screenshot for the changelog entry "Wheel of Wonder: meet a Hedgie who is here right now". */
test("a member opens the Wheel of Wonder @changelog", async ({ page, signInAs }, testInfo) => {
  await signInAs("member");
  await page.goto("/wheel-of-wonder");
  await page.waitForLoadState("networkidle");
  await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
  await shot(page, testInfo, "wheel-of-wonder");
});
