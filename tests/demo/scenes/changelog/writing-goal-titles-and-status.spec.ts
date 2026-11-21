import { expect, shot, test } from "../../fixtures";

/** Screenshot for the changelog entry "writing-goal-titles-and-status": run on demand with `pnpm changelog:capture writing-goal-titles-and-status`. */
test("a member sees goals with titles and status @changelog", async ({ page, signInAs }, testInfo) => {
  await signInAs("member");
  await page.goto("/projects");
  await page.getByRole("link", { name: /The Lighthouse Bakery Murders/ }).first().click();
  await expect(page.getByRole("heading", { name: /The Lighthouse Bakery Murders/ }).first()).toBeVisible();
  await expect(page.getByText("Achieved").first()).toBeVisible();
  await shot(page, testInfo, "goals");
});
