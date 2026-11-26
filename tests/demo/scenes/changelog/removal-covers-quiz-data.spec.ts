import { expect, shot, test } from "../../fixtures";
import { DEMO_QUIZ_ATTEMPT_AUTHORS } from "../../courses-seed";
import { sessionCookies } from "../../auth";
import { demoMemberIdByEmail, removeTwoStep } from "../../db";

/**
 * Screenshots for the changelog entry "Removing a member now removes their quiz answers and their Kajabi course data too": the
 * "Remove on request" panel of an invented member who took the demo quiz, after "See what would be removed" (the dry run: counts
 * only, nothing is deleted). Run on demand with `pnpm changelog:capture removal-covers-quiz-data`; tagged @changelog so the scheduled
 * help-screenshots run leaves it out. The scene never types the member's name or presses Remove, so it changes nothing in the demo,
 * except that the admin signs in with a second step (so the page shows no "set up two-step sign-in" reminder); the step is taken
 * away again afterwards.
 */
test.afterEach(async () => {
  await removeTwoStep("admin");
});

test("staff see what removing a member would remove, quiz answers included @changelog", async ({ page, context, signInAs }, testInfo) => {
  await signInAs("admin");
  await context.addCookies(await sessionCookies("admin", { twoStep: true }));

  // The member page's Account tab is a path of its own.
  await page.goto(`/admin/members/${await demoMemberIdByEmail(DEMO_QUIZ_ATTEMPT_AUTHORS[0])}/account`);
  await expect(page.getByRole("heading", { name: "Remove on request" })).toBeVisible();

  await page.getByRole("button", { name: "See what would be removed" }).click();
  const panel = page.locator("section").filter({ has: page.getByRole("heading", { name: "Remove on request" }) });
  await expect(panel.getByRole("button", { name: /Quiz answers/ })).toBeVisible();

  // Tall enough for the whole panel to be on the screen, so its picture is not cut at the edge of the scrolling area.
  await page.setViewportSize({ width: 1280, height: 1800 });
  await shot(page, testInfo, "removal-dry-run", { element: panel });
  await page.setViewportSize({ width: 1280, height: 800 });
});
