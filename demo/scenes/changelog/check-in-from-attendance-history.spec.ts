import { expect, shot, test } from "../../fixtures";

/** Screenshot for the changelog entry "Check in and out from your attendance history". */
test("a member opens attendance history @changelog", async ({ page, signInAs }, testInfo) => {
  await signInAs("member");
  await page.goto("/my-prickles/history");
  await page.waitForLoadState("networkidle");
  await expect(page.getByRole("button", { name: /check (in|out)/i }).first()).toBeVisible();
  await page.evaluate(() => document.querySelectorAll("*").forEach((el) => { if (el.scrollTop) el.scrollTop = 0; }));
  await shot(page, testInfo, "attendance-history");
});
