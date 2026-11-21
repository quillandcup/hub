import { expect, shot, test } from "../../fixtures";

/** Screenshot for the changelog entry "Check-ins with mood scales and the Feeling Wheel": the same questions as the check-in, in the Prickle Picker. */
test("a member sees the mood scales and the Feeling Wheel @changelog", async ({ page, signInAs }, testInfo) => {
  await signInAs("member");
  await page.goto("/my-prickles/find");
  const next = page.getByRole("button", { name: "Next →" });
  for (let i = 0; i < 4; i++) {
    await next.click();
  }
  await expect(page.getByText("Feeling Wheel by Gloria Willcox (1982)")).toBeVisible();
  await page.getByRole("button", { name: "Joyful" }).click();
  await expect(page.getByRole("group", { name: /More specifically/i }).or(page.getByLabel(/More specifically/i)).first()).toBeVisible();
  await shot(page, testInfo, "feeling-wheel");
});
