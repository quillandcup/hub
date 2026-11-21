import { expect, shot, test } from "../../fixtures";

/** Screenshot for the changelog entry "Add a prickle to your calendar from the Upcoming list". */
test("a member sees the calendar icon in Upcoming @changelog", async ({ page, signInAs }, testInfo) => {
  await signInAs("member");
  await page.goto("/my-prickles");
  await page.waitForLoadState("networkidle");
  await expect(page.getByRole("button", { name: /calendar/i }).first()).toBeVisible();
  await shot(page, testInfo, "upcoming-calendar-icon");
});
