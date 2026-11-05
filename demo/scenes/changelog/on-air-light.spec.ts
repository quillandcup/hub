import { expect, shot, test } from "../../fixtures";

/** Screenshot for the changelog entry "On air light": the header light opened to show the room and the Zoom link. */
test("a member opens the On air light @changelog", async ({ page, signInAs }, testInfo) => {
  await signInAs("member");
  await page.goto("/dashboard");
  await page.getByRole("button", { name: /off air|on air/i }).click();
  const room = page.getByRole("dialog", { name: "Prickle room" });
  await expect(room).toBeVisible();
  await expect(room.getByRole("link", { name: /on Zoom/ })).toBeVisible();
  await shot(page, testInfo, "on-air-popover");
});
