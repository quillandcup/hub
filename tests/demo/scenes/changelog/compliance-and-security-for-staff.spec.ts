import { expect, shot, test } from "../../fixtures";

/** Screenshot for the changelog entry "compliance-and-security-for-staff": run on demand with `pnpm changelog:capture compliance-and-security-for-staff`. */
test("staff open the Privacy detail page @changelog", async ({ page, signInAs }, testInfo) => {
  await signInAs("admin");
  await page.goto("/admin/privacy");
  await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
  await shot(page, testInfo, "privacy-detail");
});
