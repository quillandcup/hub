import { expect, shot, test } from "../../fixtures";
import { demoChannelId } from "../../video/slack-stand-in";

/** Screenshots for "Hub chat is now open to every member": a conversation with a thread, and the message box with formatting. */
test("a member reads a conversation and opens the message box @changelog", async ({ page, signInAs }, testInfo) => {
  await signInAs("member");
  await page.goto(`/chat/${await demoChannelId("craft-talk")}`);
  await page.waitForLoadState("networkidle");
  await expect(page.getByText("how do you keep the middle of a mystery").first()).toBeVisible();
  await shot(page, testInfo, "conversation");

  const box = page.getByRole("textbox", { name: /^Message/ });
  await box.click();
  await page.getByRole("button", { name: "Quote" }).click();
  await box.pressSequentially("Write drunk, edit sober.");
  await expect(page.locator(".ProseMirror blockquote")).toHaveText("Write drunk, edit sober.");
  await shot(page, testInfo, "message-box");
});
