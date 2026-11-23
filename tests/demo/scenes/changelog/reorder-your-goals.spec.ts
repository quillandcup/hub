import { expect, shot, test } from "../../fixtures";

/** Screenshot for the changelog entry "reorder-your-goals": run on demand with `pnpm changelog:capture reorder-your-goals`. */
test("a member sees a project's goals with their grips @changelog", async ({ page, signInAs }, testInfo) => {
  await signInAs("member");
  await page.goto("/projects");
  await page.getByRole("link", { name: /The Lighthouse Bakery Murders/ }).first().click();
  await expect(page.getByText("First 10,000 words").first()).toBeVisible();
  await expect(page.getByRole("button", { name: /^Reorder / }).first()).toBeVisible();
  await shot(page, testInfo, "goals-with-grips");
});
