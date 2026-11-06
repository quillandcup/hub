import { expect, shot, test } from "../../fixtures";

/** Screenshot for the changelog entry "Streaks: celebrate showing up week after week". */
test("a member opens Streaks @changelog", async ({ page, signInAs }, testInfo) => {
  await signInAs("member");
  await page.goto("/streaks");
  await page.waitForLoadState("networkidle");
  await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
  await shot(page, testInfo, "streaks");
});
