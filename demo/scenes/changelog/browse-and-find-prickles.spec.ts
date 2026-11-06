import { expect, shot, test } from "../../fixtures";

/** Screenshot for the changelog entry "Browse every prickle, or let the Hub help you find one": All Prickles. */
test("a member browses all prickles @changelog", async ({ page, signInAs }, testInfo) => {
  await signInAs("member");
  await page.goto("/my-prickles/all");
  await page.waitForLoadState("networkidle");
  await expect(page.getByText("ALL PRICKLES", { exact: false }).first()).toBeVisible();
  await shot(page, testInfo, "all-prickles");
});
