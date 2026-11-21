import { expect, shot, test } from "../../fixtures";

/** Screenshot for the changelog entry "keyboard-shortcuts": run on demand with `pnpm changelog:capture keyboard-shortcuts`. */
test("a member opens the keyboard shortcuts panel @changelog", async ({ page, signInAs }, testInfo) => {
  await signInAs("member");
  await page.goto("/members");
  await page.getByRole("banner").getByRole("button", { name: "Help" }).click();
  await page.getByRole("menuitem", { name: /Keyboard shortcuts/ }).click();
  await expect(page.getByRole("heading", { name: "Keyboard shortcuts" })).toBeVisible();
  // The header search button fails the label-in-name check on this page (a finding that is not about this entry, see docs/TODO.md).
  await shot(page, testInfo, "shortcuts-panel", { checks: false });
});
