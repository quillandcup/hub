import { expect, shot, test } from "../../fixtures";

/** Screenshot for "Your goals and their project now show up together on your profile": the goal form's profile box. */
test("a member adds a goal and sees it shows its project on the profile @changelog", async ({ page, signInAs }, testInfo) => {
  await signInAs("member");
  await page.goto("/projects");
  await page.getByRole("link", { name: /The Lighthouse Bakery Murders/ }).first().click();
  await expect(page.getByRole("heading", { name: /The Lighthouse Bakery Murders/ }).first()).toBeVisible();
  await page.getByRole("button", { name: /add (a )?goal|new goal|set a goal/i }).first().click();
  const box = page.getByText(/Show on my profile/);
  await expect(box).toBeVisible();
  await box.scrollIntoViewIfNeeded();
  await shot(page, testInfo, "goal-on-profile");
});
