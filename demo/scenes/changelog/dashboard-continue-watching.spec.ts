import { expect, shot, test } from "../../fixtures";

/** Screenshot for the changelog entry "Continue watching on your dashboard". Run with `pnpm changelog:capture dashboard-continue-watching`. */
test("a member sees Continue watching on the dashboard @changelog", async ({ page, signInAs }, testInfo) => {
  await signInAs("member");

  await page.goto("/dashboard");
  await expect(page.getByText("Continue watching", { exact: false }).first()).toBeVisible();
  await shot(page, testInfo, "continue-watching");
});
