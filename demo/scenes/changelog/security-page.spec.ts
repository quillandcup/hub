import { expect, shot, test } from "../../fixtures";

/** Screenshot for the changelog entry "security-page": run on demand with `pnpm changelog:capture security-page`. */
test("a member reads the Security page @changelog", async ({ page, signInAs }, testInfo) => {
  await signInAs("member");
  await page.goto("/security");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await shot(page, testInfo, "security-page");
});
