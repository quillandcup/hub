import { expect, shot, test } from "../../fixtures";
import { botIdentity, slackHomePage } from "../../mockups/rest-frames";
import { buildSlackSignInBlocks } from "@/lib/slack-sign-in";
import { APP_URL } from "@/lib/config";
import { persona } from "../../personas";

/**
 * Screenshot for the changelog entry "Sign in to the Hub from Slack". A MOCKUP frame: the demo stack has no Slack
 * workspace, so the app's Home tab is drawn (demo/mockups/rest-frames.tsx) from the real blocks `buildSlackSignInBlocks()`
 * assembles, with a placeholder link and code. Not a page of the app, so the page checks are off.
 */
test("the Slack Home tab with the sign-in button @changelog", async ({ page }, testInfo) => {
  const { name, logo } = botIdentity();
  const blocks = buildSlackSignInBlocks(
    { status: "ok", userId: "demo-user", email: persona("member").email },
    { url: `${APP_URL}/auth/slack?token=demo`, code: "DEMO000000", expiresAt: new Date(Date.now() + 3_600_000), ttlMinutes: 60 },
    APP_URL,
    { withRefresh: true },
  );
  await page.setContent(slackHomePage(blocks, name, logo));
  await expect(page.locator("[data-frame]")).toBeVisible();
  await expect(page.getByText("Open Hedgie Hub").first()).toBeVisible();
  await shot(page, testInfo, "slack-home-sign-in", { element: page.locator("[data-frame]"), checks: false });
});
