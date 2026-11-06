import { expect, shot, test } from "../../fixtures";

/**
 * Screenshots for "Check in or out at any time during a prickle": the running prickle in the upcoming list offers
 * Check out beside Check in. Needs the live prickle from demo/live-seed.ts: run `pnpm demo:seed` right before, and
 * capture within the hour (it ends 40 minutes after the seed). `pnpm changelog:capture check-in-and-check-out`.
 */
test("a running prickle offers Check in and Check out @changelog", async ({ page, signInAs }, testInfo) => {
  await signInAs("member");
  await page.goto("/my-prickles");
  const checkOut = page.getByRole("link", { name: "Check out →" });
  await expect(checkOut).toBeVisible();
  await expect(page.getByRole("link", { name: "Check in →" })).toBeVisible();
  await checkOut.scrollIntoViewIfNeeded();
  await shot(page, testInfo, "running-prickle-check-out");
});
