import { expect, shot, test } from "../../fixtures";

/** Screenshot for the changelog entry "Events is open to every member": the Events page with its picture cards. */
test("a member opens Events @changelog", async ({ page, signInAs }, testInfo) => {
  await signInAs("member");
  await page.goto("/events");
  await page.waitForLoadState("networkidle");
  await expect(page.getByRole("heading", { name: "Events", level: 1 })).toBeVisible();
  await expect(page.getByText("Cozy Mystery Workshop").first()).toBeVisible();
  await shot(page, testInfo, "events", { fullPage: true });
});
