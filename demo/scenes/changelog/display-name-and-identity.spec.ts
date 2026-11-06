import { expect, shot, test } from "../../fixtures";

/** Screenshot for changelog entry "Choose your display name". Run with `pnpm changelog:capture display-name-and-identity`. */
test("a member opens Identity settings @changelog", async ({ page, signInAs }, testInfo) => {
  await signInAs("member");
  await page.goto("/settings/identity");
  const h = page.getByRole("heading", { name: "Display Name" });
  await h.scrollIntoViewIfNeeded();
  await expect(h).toBeVisible();
  await shot(page, testInfo, "identity-settings");
});
