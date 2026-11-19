import { expect, shot, test } from "../../fixtures";

/** Screenshot for the changelog entry "compliance-page": run on demand with `pnpm changelog:capture compliance-page`. */
test("a member reads the Compliance page @changelog", async ({ page, signInAs }, testInfo) => {
  await signInAs("member");
  await page.goto("/compliance");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await shot(page, testInfo, "compliance-page");
});
