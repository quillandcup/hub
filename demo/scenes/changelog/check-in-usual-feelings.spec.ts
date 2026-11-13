import { expect, shot, test } from "../../fixtures";

/**
 * Screenshot for "Your most-used feelings come first when you check in": the member's past check-ins come from
 * demo/member-content-seed.ts, the running prickle from demo/live-seed.ts. Run `pnpm demo:seed` right before and capture within the hour.
 */
test("a member sees their most-used feelings first @changelog", async ({ page, signInAs }, testInfo) => {
  await signInAs("member");
  await page.goto("/my-prickles");
  await page.getByRole("link", { name: "Check in →" }).first().click();
  await expect(page.getByText("Frequently used")).toBeVisible();
  await page.getByText("Frequently used").scrollIntoViewIfNeeded();
  await shot(page, testInfo, "frequently-used");
});
