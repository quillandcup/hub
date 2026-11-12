import { expect, shot, test } from "../fixtures";
import { DEMO_COURSE_SLUGS, DEMO_SHARED_LESSON } from "../courses-seed";
import { demoChannelId } from "../video/slack-stand-in";

/** The help article "Share a lesson video in chat": the share box on a lesson, and the card it makes in a conversation. */
test("share a lesson video in chat", async ({ page, signInAs }, testInfo) => {
  await signInAs("member");
  await page.goto(`/courses/${DEMO_COURSE_SLUGS.current}`);
  await page.getByRole("link", { name: new RegExp(DEMO_SHARED_LESSON.title) }).first().click();
  await page.getByRole("button", { name: "Share this video in chat" }).click();
  await expect(page.getByLabel("Where to share")).toBeVisible();
  // Just the share box: the demo has no real video, so the player above it can only show an error.
  await shot(page, testInfo, "share-box", { element: page.getByRole("button", { name: "Share this video in chat" }).locator("xpath=ancestor::div[contains(@class, 'mt-3')][1]") });

  await page.goto(`/chat/${await demoChannelId("craft-talk")}`);
  const card = page.getByRole("button", { name: new RegExp(`Play ${DEMO_SHARED_LESSON.title}`) });
  await expect(card).toBeVisible();
  await expect(card.locator("img")).toHaveJSProperty("complete", true);
  await card.scrollIntoViewIfNeeded();
  await shot(page, testInfo, "video-card");
});
