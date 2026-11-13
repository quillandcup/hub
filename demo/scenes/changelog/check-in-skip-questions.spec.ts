import { expect, shot, test } from "../../fixtures";

/**
 * Screenshot for "Skip any check-in question": the check-in form on the running prickle. Needs the live prickle from
 * demo/live-seed.ts: run `pnpm demo:seed` right before and capture within the hour.
 */
test("a member sees Skip on a check-in question @changelog", async ({ page, signInAs }, testInfo) => {
  await signInAs("member");
  await page.goto("/my-prickles");
  await page.getByRole("link", { name: "Check in →" }).first().click();
  const skip = page.getByRole("button", { name: "Skip", exact: true }).first();
  await expect(skip).toBeVisible();
  await skip.scrollIntoViewIfNeeded();
  await shot(page, testInfo, "skip");
});
