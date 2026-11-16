import { expect, shot, test } from "../../fixtures";
import { DEMO_COURSE_SLUGS, DEMO_SHARED_LESSON } from "../../courses-seed";
import { demoChannelId } from "../../video/slack-stand-in";

/** Screenshots for "Watch a course lesson right in a chat message": the card a member with the course sees, what someone without it sees, and the copy-link row on the lesson. */

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
  // Just the card: the conversation around it changes with the demo's other messages.
  await shot(page, testInfo, "no-course", { element: note.locator("xpath=ancestor::div[contains(@class, 'max-w-xl')][1]") });
});

test("the lesson page offers a link to paste into chat @changelog", async ({ page, signInAs }, testInfo) => {
  await signInAs("member");
  await page.goto(`/courses/${DEMO_COURSE_SLUGS.current}`);
  await page.getByRole("link", { name: new RegExp(DEMO_SHARED_LESSON.title) }).first().click();
  await expect(page.getByRole("button", { name: "Copy link" })).toBeVisible();
  // Just the copy-link row: the demo has no real video, so the player above it can only show an error.
  await shot(page, testInfo, "copy-link", { element: page.getByRole("button", { name: "Copy link" }).locator("xpath=..") });
});

test("a lesson watched in a conversation is marked complete @changelog", async ({ page, signInAs }, testInfo) => {
  await signInAs("member");
  await page.goto(`/courses/${DEMO_COURSE_SLUGS.current}`);
  await page.getByRole("link", { name: new RegExp(DEMO_SHARED_LESSON.title) }).first().click();
  const lessonPath = new URL(page.url()).pathname;

  await page.goto(`/chat/${await demoChannelId("craft-talk")}`);
  const card = page.getByRole("button", { name: PLAY });
  await expect(card.locator("img")).toHaveJSProperty("complete", true);
  // The demo has no video provider, so the playback request is answered with made-up links and the lesson already complete (what the
  // server says for a member who has watched it through); the player itself can only show its error, which is dismissed below.
  await page.route(/\/api\/chat\/videos\/msg_[^/]+$/, (route) =>
    route.request().method() === "POST"
      ? route.fulfill({
          json: {
            title: DEMO_SHARED_LESSON.title,
            lessonId: lessonPath.split("/").pop(),
            lessonHref: lessonPath,
            playbackId: "demo-playback",
            tokens: { playback: "demo", poster: "demo", storyboard: "demo" },
            restricted: false,
            // Not recorded: the made-up links would only make the player's watch reports fail. The note comes from `completion`.
            record: false,
            resumeSeconds: 0,
            completion: { completed: true },
          },
        })
      : route.fallback(),
  );
  await card.click();
  await expect(page.getByText("✓ Lesson complete")).toBeVisible();
  await page.getByRole("button", { name: "OK" }).click();
  await expect(page.getByRole("alertdialog")).toBeHidden();
  const opened = page.getByText("✓ Lesson complete").locator("xpath=ancestor::div[contains(@class, 'max-w-xl')][1]");
  await opened.scrollIntoViewIfNeeded();
  // Just the card: the note under the video is small on a whole page.
  await shot(page, testInfo, "lesson-complete", { element: opened });
});
