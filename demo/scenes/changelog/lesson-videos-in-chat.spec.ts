import { expect, shot, test } from "../../fixtures";
import { DEMO_COURSE_SLUGS, DEMO_SHARED_LESSON } from "../../courses-seed";
import { demoChannelId } from "../../video/slack-stand-in";

/** Screenshots for "Watch a course lesson right in a chat message": the card a member with the course sees, what someone without it sees, and the share box on the lesson. */

const PLAY = new RegExp(`Play ${DEMO_SHARED_LESSON.title}`);

test("a member with the course sees the video card in a conversation @changelog", async ({ page, signInAs }, testInfo) => {
  await signInAs("member");
  await page.goto(`/chat/${await demoChannelId("craft-talk")}`);
  const card = page.getByRole("button", { name: PLAY });
  await expect(card).toBeVisible();
  // The card's picture has loaded before the picture is taken.
  await expect(card.locator("img")).toHaveJSProperty("complete", true);
  await card.scrollIntoViewIfNeeded();
  await shot(page, testInfo, "video-card");
});

test("a member without the course is told what it is part of @changelog", async ({ page, signInAs }, testInfo) => {
  await signInAs("regular1");
  await page.goto(`/chat/${await demoChannelId("craft-talk")}`);
  const note = page.getByText("You need access to the course to watch it.");
  await expect(note).toBeVisible();
  await note.scrollIntoViewIfNeeded();
  await shot(page, testInfo, "no-course");
});

test("the lesson page offers to share the video @changelog", async ({ page, signInAs }, testInfo) => {
  await signInAs("member");
  await page.goto(`/courses/${DEMO_COURSE_SLUGS.current}`);
  await page.getByRole("link", { name: new RegExp(DEMO_SHARED_LESSON.title) }).first().click();
  await page.getByRole("button", { name: "Share this video in chat" }).click();
  await expect(page.getByLabel("Where to share")).toBeVisible();
  // Just the share box: the demo has no real video, so the player above it can only show an error.
  await shot(page, testInfo, "share-box", { element: page.getByRole("button", { name: "Share this video in chat" }).locator("xpath=ancestor::div[contains(@class, 'mt-3')][1]") });
});
