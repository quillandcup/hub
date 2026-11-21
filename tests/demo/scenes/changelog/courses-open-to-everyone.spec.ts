import { expect, shot, test } from "../../fixtures";

/** Screenshots for "Courses are open to every member": the member's course list with progress, and the dashboard's Continue watching card. */
test("a member sees their courses @changelog", async ({ page, signInAs }, testInfo) => {
  await signInAs("member");
  await page.goto("/courses");
  await expect(page.getByRole("heading", { name: "Courses", level: 1 })).toBeVisible();
  await expect(page.getByRole("progressbar", { name: "Finish Your First Draft progress" })).toBeVisible();
  await shot(page, testInfo, "courses-list");

  await page.goto("/dashboard");
  await expect(page.getByText("Continue watching", { exact: false }).first()).toBeVisible();
  await shot(page, testInfo, "continue-watching");
});
