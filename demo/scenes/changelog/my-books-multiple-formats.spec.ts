import { expect, shot, test } from "../../fixtures";

/** Screenshot for the changelog entry "my-books-multiple-formats": run on demand with `pnpm changelog:capture my-books-multiple-formats`. Nothing is saved. */
test("a member sees a book with print and ebook editions @changelog", async ({ page, signInAs }, testInfo) => {
  await signInAs("member");
  await page.goto("/projects/books");
  await expect(page.getByText(/Print/).first()).toBeVisible();
  await shot(page, testInfo, "my-books");
});
