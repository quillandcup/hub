import { expect, shot, test } from "../../fixtures";

/** Screenshot for the changelog entry "My Writing: projects, goals and progress". */
test("a member opens My Writing @changelog", async ({ page, signInAs }, testInfo) => {
  await signInAs("member");
  await page.goto("/projects");
  await page.waitForLoadState("networkidle");
  await expect(page.getByRole("heading", { name: "My Writing", level: 1 })).toBeVisible();
  await shot(page, testInfo, "projects");
});
