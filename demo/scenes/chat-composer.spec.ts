import { expect, shot, test } from "../fixtures";
import { demoChannelId } from "../video/slack-stand-in";

/**
 * The message box with formatting on: a quote started and text typed in it, so the toolbar's lit button, the quote's
 * bar and its text are on screen for the page checks (contrast, labels), at every size and in both themes. The
 * empty box alone shows none of that.
 */
test("the message box with a quote being written passes the page checks", async ({ page, signInAs }, testInfo) => {
  await signInAs("member");
  await page.goto(`/chat/${await demoChannelId("craft-talk")}`);
  await page.waitForLoadState("networkidle");

  const box = page.getByRole("textbox", { name: /^Message/ });
  await box.click();
  await page.getByRole("button", { name: "Quote" }).click();
  await box.pressSequentially("Write drunk, edit sober.");
  await expect(page.locator(".ProseMirror blockquote")).toHaveText("Write drunk, edit sober.");
  await shot(page, testInfo, "quote");
});
