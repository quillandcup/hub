import { expect, shot, test } from "../../fixtures";

/** Screenshot for the changelog entry "check-in-and-check-out-dms": run on demand with `pnpm changelog:capture check-in-and-check-out-dms`. */
test("a member chooses check-in and check-out messages @changelog", async ({ page, signInAs }, testInfo) => {
  await signInAs("member");
  await page.goto("/settings/notifications");
  await expect(page.getByText("Prickle check-ins")).toBeVisible();
  await shot(page, testInfo, "check-in-settings");
});
