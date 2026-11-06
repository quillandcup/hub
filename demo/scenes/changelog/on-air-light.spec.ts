import { expect, shot, test } from "../../fixtures";

/**
 * Screenshots for the changelog entry "On air light": the lit red light with people at the table, and who is there.
 * Needs the live state from demo/live-seed.ts: run `pnpm demo:seed` right before, and capture within the hour (the room's
 * prickle started 20 minutes before the seed and ends 40 minutes after). `pnpm changelog:capture on-air-light`.
 */
test("the On air light is lit with Hedgies at the table @changelog", async ({ page, signInAs }, testInfo) => {
  await signInAs("member");
  await page.goto("/dashboard");
  const light = page.getByRole("banner").getByRole("button", { name: /On air/ });
  await expect(light).toBeVisible();
  await light.click();
  const room = page.getByRole("dialog", { name: "Prickle room" });
  await expect(room.getByText("Join on Zoom")).toBeVisible();
  await expect(room.getByRole("link", { name: "Julia Sample" })).toBeVisible();
  await shot(page, testInfo, "on-air-popover");
});
