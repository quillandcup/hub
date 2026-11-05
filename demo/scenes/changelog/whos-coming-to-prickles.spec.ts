import { expect, shot, test } from "../../fixtures";

/** Screenshot for the changelog entry "See who is coming to upcoming prickles": an upcoming prickle's page. */
test("a member sees who is coming @changelog", async ({ page, signInAs }, testInfo) => {
  await signInAs("member");
  await page.goto("/my-prickles");
  await page.getByRole("link", { name: /Progress Prickle/ }).first().click();
  await expect(page.getByText(/Who.s coming/i).first()).toBeVisible();
  await shot(page, testInfo, "whos-coming");
});
