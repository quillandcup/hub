import { resetNavMode } from "../../db";
import { expect, shot, test } from "../../fixtures";

// The scene changes a saved setting on the shared demo stack: put it back even when an assertion fails.
test.afterEach(async () => {
  await resetNavMode("member");
});

/** Screenshot for the changelog entry "sidebar-modes": run on demand with `pnpm changelog:capture sidebar-modes`. */
test("a member sets the side menu to auto-hide @changelog", async ({ page, signInAs }, testInfo) => {
  await signInAs("member");
  await page.goto("/dashboard");
  const mode = (name: RegExp) => page.getByRole("button", { name });
  // The choice is remembered, so first put it in a known state (pinned open), then choose auto-hide.
  await page.getByRole("complementary", { name: "Sidebar navigation" }).hover();
  for (let i = 0; i < 3 && !(await mode(/^Sidebar pinned open/).first().isVisible()); i++) {
    await page.getByRole("button", { name: /^Sidebar (auto-hides|pinned closed)/ }).first().click();
  }
  await expect(mode(/^Sidebar pinned open/).first()).toBeVisible();
  await mode(/^Sidebar pinned open/).first().click();
  await page.mouse.move(700, 400);
  await expect(page.getByRole("heading", { name: "Home", level: 2 })).toBeHidden();
  await shot(page, testInfo, "auto-hide-rail");

  await page.getByRole("complementary", { name: "Sidebar navigation" }).hover();
  await expect(mode(/^Sidebar auto-hides/).first()).toBeVisible();
});
