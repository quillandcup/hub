import { expect, shot, test } from "../fixtures";

/**
 * How to join a prickle: find one coming up, then open the "On air" light for the Zoom link, meeting ID and passcode.
 */
test("a member finds a prickle and the link to join it", async ({ page, signInAs }, testInfo) => {
  await signInAs("member");

  await page.goto("/dashboard");
  await expect(page.getByText("Upcoming prickles", { exact: false }).first()).toBeVisible();
  await expect(page.getByText("Progress Prickle").first()).toBeVisible();
  await shot(page, testInfo, "dashboard");

  await page.getByRole("button", { name: /off air|on air/i }).click();
  const room = page.getByRole("dialog", { name: "Prickle room" });
  await expect(room).toBeVisible();
  await expect(room.getByRole("link", { name: /on Zoom/ })).toHaveAttribute("href", /zoom\.example\.com/);
  await expect(room.getByText(/Meeting ID/)).toBeVisible();
  await expect(room.getByText(/Passcode/)).toBeVisible();
  await shot(page, testInfo, "on-air-popover");

  await page.goto("/my-prickles/find");
  await page.waitForLoadState("networkidle");
  await shot(page, testInfo, "find-a-prickle");
});
