import { expect, shot, test } from "../../fixtures";

/** Screenshot for changelog entry "Hover cards for members". Run with `pnpm changelog:capture member-hover-card`. */
test("a member points at a name @changelog", async ({ page, signInAs }, testInfo) => {
  await signInAs("member");
  await page.goto("/streaks");
  const link = page.locator('main a[href^="/members/"]').first();
  await expect(link).toBeVisible();
  await link.hover();
  await expect(page.getByRole("link", { name: "View profile" }).first()).toBeVisible();
  await shot(page, testInfo, "hover-card");
});
