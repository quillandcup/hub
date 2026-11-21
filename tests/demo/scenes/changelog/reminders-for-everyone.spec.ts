import { expect, shot, test } from "../../fixtures";

/** Screenshot for the changelog entry "reminders-for-everyone": run on demand with `pnpm changelog:capture reminders-for-everyone`. */
test("a member chooses where reminders arrive @changelog", async ({ page, signInAs }, testInfo) => {
  await signInAs("member");
  await page.goto("/settings/notifications");
  await expect(page.getByRole("heading", { name: /notifications/i }).first()).toBeVisible();
  await shot(page, testInfo, "reminder-settings");
});
