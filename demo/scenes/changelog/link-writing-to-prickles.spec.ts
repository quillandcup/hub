import { expect, shot, test } from "../../fixtures";

/** Screenshot for the changelog entry "Link your writing progress to the prickle you wrote in": the Log progress window. */
test("a member opens Log progress and sees the prickle picker @changelog", async ({ page, signInAs }, testInfo) => {
  await signInAs("member");
  await page.goto("/projects");
  await page.getByRole("button", { name: "+ Log progress" }).first().click();
  await expect(page.getByText(/During which prickle/i).first()).toBeVisible();
  await shot(page, testInfo, "log-progress");
});
