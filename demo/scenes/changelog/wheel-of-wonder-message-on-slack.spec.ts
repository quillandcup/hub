import { expect, shot, test } from "../../fixtures";

/**
 * Screenshot for the changelog entry "Wheel of Wonder waits for you": the result after a spin, with the match and the
 * Message on Slack button that has not been pressed yet.
 *
 * The demo stack has no Slack workspace, so the real spin (which asks Slack who is online) answers "Slack isn't
 * configured". The scene lets the real server action run and swaps only its result for a fictional winner, so the page
 * that draws the wheel, the match and the button is the app's own. The spin writes nothing, and nothing is sent to Slack.
 */
const WINNER = { memberId: "mbr_AAAAAAAAAAA1", memberName: "Rosa Demo", photoUrl: null };
const REEL = ["Hazel Hosting", "Julia Sample", "Willa Placeholder", "Rosa Demo", "Hazel Hosting", "Julia Sample", "Willa Placeholder", "Rosa Demo"].map((memberName, i) => ({
  memberId: `mbr_AAAAAAAAAAA${i + 2}`,
  memberName,
  photoUrl: null,
}));

test("a member spins the Wheel of Wonder and sees the match @changelog", async ({ page, signInAs }, testInfo) => {
  await signInAs("member");
  // The spin is a server action: its response is a Flight stream whose line "1:" is the action's return value.
  await page.route("**/wheel-of-wonder", async (route) => {
    if (route.request().method() !== "POST" || !route.request().headers()["next-action"]) return route.continue();
    const real = await route.fetch();
    const text = (await real.text()).replace(/^1:.*$/m, `1:${JSON.stringify({ winner: WINNER, reel: REEL })}`);
    await route.fulfill({ response: real, body: text });
  });
  await page.goto("/wheel-of-wonder");
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: "Spin the Wheel" }).click();
  await expect(page.getByRole("button", { name: /Message on Slack/ })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("button", { name: "Spin Again" })).toBeVisible();
  await shot(page, testInfo, "wheel-match");
});
