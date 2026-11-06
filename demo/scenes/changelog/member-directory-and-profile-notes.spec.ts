import { expect, shot, test } from "../../fixtures";

/** Screenshot for changelog entry "Member directory, Ask me about topics and private notes". Run with `pnpm changelog:capture member-directory-and-profile-notes`. */
test("a member browses the Members page @changelog", async ({ page, signInAs }, testInfo) => {
  await signInAs("member");
  await page.goto("/members");
  await expect(page.getByText("Willa Placeholder").first()).toBeVisible();
  await shot(page, testInfo, "members-directory");
});
