import { expect, shot, test } from "../../fixtures";
import { demoChannelId } from "../../video/slack-stand-in";

/** Screenshots for "Hub Chat tells you how many new messages are waiting above": a conversation marked unread from its first message, scrolled down, with the pill at the top (fictional people only). */
test("a member scrolls away from the New line and sees how many are waiting @changelog", async ({ page, signInAs }, testInfo) => {
  test.setTimeout(240_000);
  await signInAs("member");
  await page.goto(`/chat/${await demoChannelId("craft-talk")}`);
  const first = page.locator("article[id^=m-]").first();
  await first.hover();
  await page.getByRole("button", { name: "More actions" }).first().click();
  await page.getByRole("menuitem", { name: "Mark unread" }).click();
  await page.mouse.wheel(0, 4000);
  const pill = page.getByRole("button", { name: /new messages?$/ });
  await expect(pill).toBeVisible();
  await shot(page, testInfo, "new-messages-pill");
});
