import { emptyLiveRoom, restoreLiveRoom } from "../../db";
import { expect, shot, test } from "../../fixtures";

/**
 * Screenshots for the changelog entry "On air light": the lit red light with people at the table (and who is there), then
 * the grey Off air light with the empty room's "Start a PUP on Zoom". The lit state needs the live state from
 * demo/live-seed.ts: run `pnpm demo:seed` right before, and capture within the hour (the room's prickle started 20 minutes
 * before the seed and ends 40 minutes after). The empty state clears the room's participants for the capture and puts them
 * back afterwards, so the shared demo is left as found. `pnpm changelog:capture on-air-light`.
 */
test.afterEach(async () => {
  await restoreLiveRoom();
});

test("the On air light lit with Hedgies at the table, then off air @changelog", async ({ page, signInAs }, testInfo) => {
  await signInAs("member");
  await page.goto("/dashboard");
  const light = page.getByRole("banner").getByRole("button", { name: /On air/ });
  await expect(light).toBeVisible();
  await light.click();
  const room = page.getByRole("dialog", { name: "Prickle room" });
  await expect(room.getByText("Join on Zoom")).toBeVisible();
  await expect(room.getByRole("link", { name: "Julia Sample" })).toBeVisible();
  await shot(page, testInfo, "on-air-popover");

  await emptyLiveRoom();
  await page.reload();
  await page.getByRole("banner").getByRole("button", { name: /Off air/ }).click();
  await expect(page.getByRole("dialog", { name: "Prickle room" }).getByText("Start a PUP on Zoom")).toBeVisible();
  await shot(page, testInfo, "off-air-popover");
});
