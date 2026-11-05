import { expect, shot, test } from "../../fixtures";

/** Screenshot for the changelog entry "email-notifications": run on demand with `pnpm changelog:capture email-notifications`. */
test("a member sees the email channel in Notifications settings @changelog", async ({ page, signInAs }, testInfo) => {
  await signInAs("member");
  await page.goto("/settings/notifications");
  await expect(page.getByRole("heading", { name: /notifications/i }).first()).toBeVisible();
  await shot(page, testInfo, "notification-settings");
});
