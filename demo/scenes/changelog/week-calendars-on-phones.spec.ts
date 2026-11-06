import { expect, shot, test } from "../../fixtures";

/** Screenshot for the changelog entry "Week calendars scroll on phones": All Prickles, Calendar view at phone width. */
test("a member views the week calendar on a phone @changelog", async ({ page, signInAs }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await signInAs("member");
  await page.goto("/my-prickles/all");
  await page.getByRole("button", { name: "Calendar", exact: true }).click();
  await expect(page.getByText("Sun").first()).toBeVisible();
  await shot(page, testInfo, "week-on-phone");
});
