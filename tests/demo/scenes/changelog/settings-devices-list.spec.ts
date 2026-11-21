import { giveSessionsDevices } from "../../db";
import { expect, shot, test } from "../../fixtures";

/** Screenshot for the changelog entry "Your signed-in devices are easier to recognize": Devices on the Account tab of Settings. */
test("a member sees their devices in Settings @changelog", async ({ page, signInAs }, testInfo) => {
  await signInAs("member");
  await giveSessionsDevices("member");
  await page.goto("/settings");
  const heading = page.getByRole("heading", { name: "Devices" });
  await expect(heading).toBeVisible();
  await expect(page.getByText("Chrome 156 on macOS")).toBeVisible();
  await expect(page.getByText("This device", { exact: true })).toBeVisible();
  await heading.scrollIntoViewIfNeeded();
  await shot(page, testInfo, "devices");
});
