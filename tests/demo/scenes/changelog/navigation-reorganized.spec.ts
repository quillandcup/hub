import { expect, shot, test } from "../../fixtures";

/** Screenshot for the changelog entry "Clearer navigation and a footer": the dashboard with the sidebar pinned open (the default mode). */
test("a member sees the reorganized sidebar @changelog", async ({ page, signInAs }, testInfo) => {
  await signInAs("member");
  await page.goto("/dashboard");
  await page.waitForLoadState("networkidle");
  await expect(page.getByRole("link", { name: "Events" }).first()).toBeVisible();
  await shot(page, testInfo, "sidebar");
});
