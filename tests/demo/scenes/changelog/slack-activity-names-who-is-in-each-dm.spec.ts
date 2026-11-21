import { expect, shot, test } from "../../fixtures";

/**
 * Screenshot for the changelog entry "slack-activity-names-who-is-in-each-dm": run on demand with
 * `pnpm changelog:capture slack-activity-names-who-is-in-each-dm`. Staff open a member's Slack Activity tab, where each private
 * conversation now names the others in it (the demo seed writes a DM and a group DM for the demo member).
 */
test("staff read a member's Slack Activity tab @changelog", async ({ page, signInAs }, testInfo) => {
  await signInAs("admin");
  await page.goto("/admin/members");
  await page.getByRole("link", { name: /Maya Example/ }).first().click();
  await page.getByRole("tab", { name: /^Slack Activity/ }).click();
  await expect(page.getByText(/^DM: /).first()).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText(/^Group: /).first()).toBeVisible();
  await page.addStyleTag({ content: "nextjs-portal, div.fixed.bottom-4.right-4 { display: none !important; }" });
  await page.getByRole("heading", { name: "Recent Activity" }).scrollIntoViewIfNeeded();
  await shot(page, testInfo, "slack-activity", { checks: false });
});
