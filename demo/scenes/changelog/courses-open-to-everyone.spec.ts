import { expect, shot, test } from "../../fixtures";

/** Screenshot for "Courses are now open to every member": the member's course list with progress. */
test("a member sees their courses @changelog", async ({ page, signInAs }, testInfo) => {
  await signInAs("member");
  await page.goto("/courses");
  await expect(page.getByRole("heading", { name: "Courses", level: 1 })).toBeVisible();
  await expect(page.getByRole("progressbar", { name: "Finish Your First Draft progress" })).toBeVisible();
  await shot(page, testInfo, "courses-list");
});
