import { expect, shot, test } from "../../fixtures";

/** Screenshot for changelog entry "Hedgie Help". Run with `pnpm changelog:capture member-help-articles`. */
test("a member opens Hedgie Help @changelog", async ({ page, signInAs }, testInfo) => {
  await signInAs("member");
  await page.goto("/help");
  await expect(page.getByRole("heading", { name: "Hedgie Help", level: 1 })).toBeVisible();
  await shot(page, testInfo, "help-index");
});
