import { expect, shot, test } from "../../fixtures";

/**
 * Screenshots for "Join details for the prickle room": after checking in to the running prickle, the window shows the
 * meeting ID and passcode with a Join button. Needs the live prickle from demo/live-seed.ts: run `pnpm demo:seed` right
 * before, and capture within the hour (it ends 40 minutes after the seed; a check-in is cleared by the next seed).
 * `pnpm changelog:capture zoom-meeting-id`.
 */
test("checking in shows the room's meeting ID and passcode @changelog", async ({ page, signInAs }, testInfo) => {
  await signInAs("member");
  await page.goto("/my-prickles");
  await page.getByRole("link", { name: "Check in →" }).click();
  const modal = page.getByRole("dialog");
  await expect(modal.getByRole("button", { name: "Save" })).toBeVisible();
  await shot(page, testInfo, "check-in-window");
  await modal.getByRole("button", { name: "Save" }).click();
  await expect(modal.getByText("Meeting ID: 000 0000 0000")).toBeVisible();
  await expect(modal.getByText("Passcode: demo")).toBeVisible();
  await shot(page, testInfo, "join-details");
});
