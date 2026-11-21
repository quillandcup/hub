import { expect, shot, test } from "../../fixtures";

/** Screenshot for the changelog entry "allow-animations": run on demand with `pnpm changelog:capture allow-animations`. */
test("a member finds the Animations choice @changelog", async ({ page, signInAs }, testInfo) => {
  await signInAs("member");
  await page.goto("/settings/preferences");
  await expect(page.getByRole("combobox", { name: "Animations" })).toBeVisible();
  await shot(page, testInfo, "animations-setting");
});
