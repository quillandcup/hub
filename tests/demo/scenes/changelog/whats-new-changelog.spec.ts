import { expect, shot, test } from "../../fixtures";

/**
 * Screenshots for the changelog entry "A changelog for the Hedgie Hub": the What's new list and the entry's own page.
 * Changelog scenes are the recipe for how an entry's screenshots were taken, run on demand with
 * `pnpm changelog:capture whats-new-changelog`. They are tagged @changelog so the scheduled help-screenshots run, which
 * tracks the current UI, leaves them out: a scene for an old entry may stop matching the app, and that is fine.
 */
test("a member opens What's new and an entry @changelog", async ({ page, signInAs }, testInfo) => {
  await signInAs("member");

  await page.goto("/dashboard");
  await page.getByRole("banner").getByRole("button", { name: "Help" }).click();
  await page.getByRole("menuitem", { name: "What's new" }).click();
  await expect(page.getByRole("heading", { name: "What's new", level: 1 })).toBeVisible();
  await shot(page, testInfo, "whats-new-list");

  await page.getByRole("link", { name: /A changelog for the Hedgie Hub/ }).click();
  await expect(page.getByRole("heading", { name: "A changelog for the Hedgie Hub", level: 1 })).toBeVisible();
  await shot(page, testInfo, "whats-new-entry");
});
