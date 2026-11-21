import { expect, shot, test } from "../../fixtures";

/** Screenshot for the changelog entry "in-the-hub-notifications": run on demand with `pnpm changelog:capture in-the-hub-notifications`. */
test("a member opens the notifications inbox @changelog", async ({ page, signInAs }, testInfo) => {
  await signInAs("member");
  await page.goto("/notifications");
  await expect(page.getByRole("heading", { name: /notifications/i }).first()).toBeVisible();
  await shot(page, testInfo, "inbox");
});
