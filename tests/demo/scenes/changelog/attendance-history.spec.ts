import { expect, shot, test } from "../../fixtures";

/** Screenshot for the changelog entry "Your attendance history": the month view. */
test("a member opens attendance history in the month view @changelog", async ({ page, signInAs }, testInfo) => {
  await signInAs("member");
  await page.goto("/my-prickles/history");
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: "Month", exact: true }).click();
  await expect(page.getByRole("heading", { name: "My Attendance" })).toBeVisible();
  await page.getByRole("button", { name: "←" }).click();
  await expect(page.getByText("October 2026")).toBeVisible();
  await shot(page, testInfo, "attendance-month");
});
