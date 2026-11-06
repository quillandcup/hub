import { expect, shot, test } from "../../fixtures";

/** Screenshot for the changelog entry "Your prickles in your own calendar, and commitments across several slots". */
test("a member sees the calendar link and commitments @changelog", async ({ page, signInAs }, testInfo) => {
  await signInAs("member");
  await page.goto("/my-prickles/commitments");
  await page.waitForLoadState("networkidle");
  await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
  await shot(page, testInfo, "commitments");
});
