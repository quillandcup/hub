import { expect, shot, test } from "../../fixtures";

/** Screenshot for the changelog entry "book-genres-as-tags": run on demand with `pnpm changelog:capture book-genres-as-tags`. */
test("a member filters the Book Shelf by genre @changelog", async ({ page, signInAs }, testInfo) => {
  await signInAs("member");
  await page.goto("/bookshelf");
  await expect(page.getByRole("heading", { name: /book shelf/i }).first()).toBeVisible();
  await shot(page, testInfo, "shelf");
});
