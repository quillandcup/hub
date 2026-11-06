import { expect, shot, test } from "../../fixtures";

/**
 * Screenshots for "A kinder nudge when a streak lapses": the seedling on an upcoming prickle whose series the member
 * once reached two weeks in a row and then stopped. The lapsed Thursday Plot or Plan series comes from
 * demo/live-seed.ts (`withLapsedStreak`): run `pnpm demo:seed` first. It does not expire with the live prickle, but the
 * seed re-lays it relative to today. `pnpm changelog:capture start-a-new-streak-nudge`.
 */
test("a lapsed streak shows the seedling on the upcoming prickle @changelog", async ({ page, signInAs }, testInfo) => {
  await signInAs("member");
  await page.goto("/my-prickles");
  const seedling = page.getByRole("img", { name: /Start a new streak/ }).first();
  await seedling.scrollIntoViewIfNeeded();
  await seedling.hover();
  await expect(page.getByRole("tooltip").getByText(/weeks in a row here/)).toBeVisible();
  await shot(page, testInfo, "seedling-badge");
});
