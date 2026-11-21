import { expect, shot, test } from "../../fixtures";

/** Screenshot for the changelog entry "Say how you feel before and after a prickle": the Prickle Picker's feelings step. */
test("a member answers how they are feeling in the Prickle Picker @changelog", async ({ page, signInAs }, testInfo) => {
  await signInAs("member");
  await page.goto("/my-prickles/find");
  const next = page.getByRole("button", { name: "Next →" });
  for (let i = 0; i < 4; i++) {
    await next.click();
  }
  await expect(page.getByRole("heading", { name: "How are you feeling?" })).toBeVisible();
  await shot(page, testInfo, "prickle-picker-feelings");
});
