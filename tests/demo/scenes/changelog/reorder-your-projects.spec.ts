import { expect, shot, test } from "../../fixtures";

/** Screenshot for the changelog entry "reorder-your-projects": run on demand with `pnpm changelog:capture reorder-your-projects`. */
test("a member sees her projects with their grips @changelog", async ({ page, signInAs }, testInfo) => {
  await signInAs("member");
  await page.goto("/projects");
  await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: /^Reorder / }).first()).toBeVisible();
  await shot(page, testInfo, "projects-with-grips");
});
