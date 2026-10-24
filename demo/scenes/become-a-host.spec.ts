import { expect, shot, test } from "../fixtures";

/** Become a host: a new member is asked to settle in first; a member who has been around can request a weekly slot. */
test("a member sees when they can host, and a host requests a slot", async ({ page, signInAs }, testInfo) => {
  await signInAs("member");
  await page.goto("/my-prickles/hosting");
  await expect(page.getByText("Settle in first")).toBeVisible();
  await shot(page, testInfo, "settle-in-first");

  await signInAs("host");
  await page.goto("/my-prickles/hosting");
  await expect(page.getByText("Your hosting stats", { exact: false })).toBeVisible();
  await shot(page, testInfo, "hosting-tab");

  await page.getByRole("button", { name: /Request to host/ }).first().click();
  await expect(page.getByText("How often will you host?")).toBeVisible();
  await page.getByRole("button", { name: "Every week" }).click();
  await expect(page.getByText("Loading calendar")).toHaveCount(0);
  await shot(page, testInfo, "request-form", { fullPage: true });
});
