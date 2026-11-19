import { expect, shot, test } from "../../fixtures";

/** Screenshot for the changelog entry "security-page" (it covers the Privacy, Security and Compliance pages): run on demand with `pnpm changelog:capture security-page`. */
test("a member reads the Security and Compliance pages @changelog", async ({ page, signInAs }, testInfo) => {
  await signInAs("member");
  await page.goto("/security");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await shot(page, testInfo, "security-page");
  await page.goto("/compliance");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await shot(page, testInfo, "compliance-page");
});
