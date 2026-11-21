import { expect, shot, test } from "../../fixtures";

/** Screenshot for changelog entry "Search finds the names people go by": the search palette matching an alternate name. Run with `pnpm changelog:capture search-and-display-names`. */
test("a member searches by an alternate name @changelog", async ({ page, signInAs }, testInfo) => {
  await signInAs("member");
  await page.goto("/dashboard");
  await page.getByRole("banner").getByRole("button", { name: /search/i }).first().click();
  const dialog = page.getByRole("dialog", { name: "Search" });
  await dialog.getByRole("textbox", { name: "Search", exact: true }).fill("Jules");
  await expect(dialog.getByText(/also known as/i).first()).toBeVisible();
  await shot(page, testInfo, "search-alternate-name");
});
