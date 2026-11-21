import { expect, shot, test } from "../../fixtures";

/** Screenshot for the changelog entry "A help menu in the top bar": the open menu. Run with `pnpm changelog:capture help-menu`. */
test("a member opens the Help menu @changelog", async ({ page, signInAs }, testInfo) => {
  await signInAs("member");

  await page.goto("/dashboard");
  await page.getByRole("banner").getByRole("button", { name: "Help" }).click();
  await expect(page.getByRole("menuitem", { name: "Hedgie Help" })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Send feedback" })).toBeVisible();
  await shot(page, testInfo, "help-menu");
});
