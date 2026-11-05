import { expect, shot, test } from "../../fixtures";

/** Screenshot for the changelog entry "Show a second time zone beside prickle times": the setting turned on, then back off. */
test("a member turns on a second time zone @changelog", async ({ page, signInAs }, testInfo) => {
  await signInAs("member");
  await page.goto("/settings/preferences");
  const box = page.getByRole("checkbox", { name: /secondary time zone/i });
  await expect(box).toBeVisible();
  await box.check();
  await expect(page.getByText("Saving...")).toBeHidden();
  await expect(box).toBeEnabled();
  await shot(page, testInfo, "second-time-zone");
  // Leave the demo member as it was found.
  await box.uncheck();
  await expect(page.getByText("Saving...")).toBeHidden();
  await expect(box).not.toBeChecked();
});
