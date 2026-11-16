import { expect, shot, test } from "../../fixtures";

/** Screenshots for "Apps now have their own place in the chat list": the sidebar with its Apps heading, between the channels and the people (fictional people only). */
test("a member sees her messages with an app under their own heading @changelog", async ({ page, signInAs }, testInfo) => {
  test.setTimeout(240_000);
  await signInAs("member");
  await page.goto("/chat");
  await expect(page.getByRole("heading", { name: "Apps" }).first()).toBeVisible();
  await expect(page.getByRole("link", { name: /Billie Bot/ }).first()).toBeVisible();
  await shot(page, testInfo, "apps-heading");
});
