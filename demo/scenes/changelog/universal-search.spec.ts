import { expect, shot, test } from "../../fixtures";

/** Screenshot for the changelog entry "Search everything from the header": the search palette with results. Run with `pnpm changelog:capture universal-search`. */
test("a member searches from the header @changelog", async ({ page, signInAs }, testInfo) => {
  await signInAs("member");

  await page.goto("/dashboard");
  await page.getByRole("banner").getByRole("button", { name: /search/i }).first().click();
  const box = page.getByRole("dialog", { name: "Search" }).getByRole("textbox", { name: "Search", exact: true });
  await expect(box).toBeVisible();
  await box.fill("will");
  await expect(page.getByRole("dialog", { name: "Search" }).getByText("Willa Placeholder").first()).toBeVisible();
  await shot(page, testInfo, "search-results");
});
