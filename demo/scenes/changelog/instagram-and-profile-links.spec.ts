import { expect, shot, test } from "../../fixtures";

/** Screenshot for the changelog entry "Instagram on your profile": Settings, Profile with the handle filled in next to Facebook and X. */
test("a member opens the Profile settings @changelog", async ({ page, signInAs }, testInfo) => {
  await signInAs("member");
  await page.goto("/settings/profile");
  await page.waitForLoadState("networkidle");
  await expect(page.locator("#profile-instagram")).toHaveValue(/maya\.writes\.example/);
  await shot(page, testInfo, "profile-links", { fullPage: true });
});
