import { expect, shot, test } from "../../fixtures";

/** Screenshot for the changelog entry "Settings: your profile, names, time zone and look": the Identity tab. */
test("a member opens the Identity settings @changelog", async ({ page, signInAs }, testInfo) => {
  await signInAs("member");
  await page.goto("/settings/identity");
  await page.waitForLoadState("networkidle");
  await expect(page.getByRole("heading", { name: "Settings", level: 1 })).toBeVisible();
  await shot(page, testInfo, "identity");
});
