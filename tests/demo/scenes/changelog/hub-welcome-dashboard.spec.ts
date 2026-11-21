import { expect, shot, test } from "../../fixtures";

/** Screenshot for the changelog entry "A dashboard that shows what is coming up". */
test("a member sees the dashboard @changelog", async ({ page, signInAs }, testInfo) => {
  await signInAs("member");
  await page.goto("/dashboard");
  await expect(page.getByText("Upcoming prickles", { exact: false }).first()).toBeVisible();
  await shot(page, testInfo, "dashboard");
});
