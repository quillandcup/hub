import { expect, shot, test } from "../../fixtures";

/** Screenshot for the changelog entry "Clearer time zone settings". */
test("a member sees the time zone settings @changelog", async ({ page, signInAs }, testInfo) => {
  await signInAs("member");
  await page.goto("/settings/preferences");
  await page.waitForLoadState("networkidle");
  await expect(page.getByText(/Use current location|time zone/i).first()).toBeVisible();
  await shot(page, testInfo, "time-zone-settings");
});
