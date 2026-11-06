import { expect, shot, test } from "../../fixtures";

/** Screenshots for the changelog entry "media-library-and-book-covers": run on demand with `pnpm changelog:capture media-library-and-book-covers`. Nothing is saved. */
test("a member opens a book and sees the cover control @changelog", async ({ page, signInAs }, testInfo) => {
  await signInAs("member");
  await page.goto("/projects/books");
  await page.getByRole("button", { name: "Edit" }).first().click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  const change = dialog.getByRole("button", { name: /Change cover|Choose cover/ });
  await change.scrollIntoViewIfNeeded();
  await change.click();
  const chooser = page.getByRole("dialog", { name: /Choose a cover/ });
  await expect(chooser).toBeVisible();
  await expect(chooser.getByText("Loading...")).toBeHidden();
  await expect.poll(() => chooser.locator("img").evaluateAll((imgs) => imgs.length > 0 && imgs.every((i) => (i as HTMLImageElement).naturalWidth > 0))).toBe(true);
  await shot(page, testInfo, "choose-cover");
});
