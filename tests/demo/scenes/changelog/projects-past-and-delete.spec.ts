import { expect, shot, test } from "../../fixtures";

/** Screenshot for the changelog entry "projects-past-and-delete": run on demand with `pnpm changelog:capture projects-past-and-delete`. */
test("a member sees past projects apart from current ones @changelog", async ({ page, signInAs }, testInfo) => {
  await signInAs("member");
  await page.goto("/projects");
  await page.getByText(/Hibernating/).first().click();
  await expect(page.getByText(/The Marmalade Affair/)).toBeVisible();
  await shot(page, testInfo, "past-projects");
});
