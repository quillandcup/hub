import { expect, shot, test } from "../../fixtures";

/** Screenshots for the changelog entry "Your books and awards, and a Bookshelf for the whole community". */
test("a member sees their books and the Bookshelf @changelog", async ({ page, signInAs }, testInfo) => {
  await signInAs("member");

  await page.goto("/projects/books");
  await page.waitForLoadState("networkidle");
  await expect(page.getByRole("heading", { name: "My Writing", level: 1 })).toBeVisible();
  await shot(page, testInfo, "my-books");

  await page.goto("/bookshelf");
  await page.waitForLoadState("networkidle");
  await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
  await shot(page, testInfo, "bookshelf");
});
