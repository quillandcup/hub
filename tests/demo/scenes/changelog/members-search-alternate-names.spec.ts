import { expect, shot, test } from "../../fixtures";

/** Screenshot for changelog entry "The Members page finds the names people go by". Run with `pnpm changelog:capture members-search-alternate-names`. */
test("a member searches the Members page by a nickname @changelog", async ({ page, signInAs }, testInfo) => {
  await signInAs("member");
  await page.goto("/members");
  await page.getByRole("searchbox").or(page.getByPlaceholder(/search/i)).first().fill("Jules");
  await expect(page.getByText(/also known as/i).first()).toBeVisible();
  await shot(page, testInfo, "members-search-alias");
});
