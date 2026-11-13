import { expect, shot, test } from "../fixtures";
import { DEMO_COURSE_SLUGS, DEMO_SHARED_LESSON } from "../courses-seed";
import { demoChannelId } from "../video/slack-stand-in";

/** The help article "Share a lesson video in chat": the share box on a lesson, and the card it makes in a conversation. */
test("share a lesson video in chat", async ({ page, signInAs }, testInfo) => {
  await signInAs("member");
  await page.goto(`/courses/${DEMO_COURSE_SLUGS.current}`);
  await page.getByRole("link", { name: new RegExp(DEMO_SHARED_LESSON.title) }).first().click();
  const lessonPath = new URL(page.url()).pathname;
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

  // The player opened: the "Open lesson" link over its corner. The demo has no Mux, so the playback request is answered with made-up
  // links (the player itself can only show its error); what is under test is the link, which is the app's own.
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
            record: false,
            resumeSeconds: 0,
          },
        })
      : route.fallback(),
  );
  await card.click();
  const link = page.getByRole("link", { name: "Open lesson" });
  await expect(link).toBeVisible();
  // Playwright counts a fully transparent element as visible, and a link that only appears on hover was once invisible to anyone not hovering: it must be opaque at rest.
  await page.getByRole("heading", { name: /craft-talk/ }).hover();
  await expect(link).toHaveCSS("opacity", "1");
  // The made-up links can't be played: the player says so in a dialog. Dismiss it, so the checks below look at the link and not at that error.
  await page.getByRole("button", { name: "OK" }).click();
  await expect(page.getByRole("alertdialog")).toBeHidden();

  // Visible is not enough: the player's own overlays once sat on top of it, so nothing could be seen or clicked. The link must be what is
  // under its own centre, in every size and colour scheme (the point of `elementFromPoint`: it answers with the topmost element there).
  const topmost = () =>
    link.evaluate((el) => {
      const box = el.getBoundingClientRect();
      const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
      return hit === el || el.contains(hit);
    });
  expect(await topmost()).toBe(true);
  // It must not sit on the player's big play square (the button itself spans the whole frame) (the label once ran into it on a phone).
  const [linkBox, playBox] = await Promise.all([link.boundingBox(), page.getByRole("button", { name: "Play video" }).locator("span").first().boundingBox()]);
  if (linkBox && playBox) {
    const apart = linkBox.x + linkBox.width <= playBox.x || playBox.x + playBox.width <= linkBox.x || linkBox.y + linkBox.height <= playBox.y || playBox.y + playBox.height <= linkBox.y;
    expect(apart, "the link and the play button overlap").toBe(true);
  }

  // Resting, then with the pointer over the frame, then with keyboard focus: axe evaluates the link's contrast in each state (the
  // checks run on every `shot`), and the focus ring has to be on screen.
  await page.getByRole("heading", { name: /craft-talk/ }).hover(); // away from the frame, and not over the side navigation (it opens on hover)
  await shot(page, testInfo, "open-lesson-link");
  await link.locator("xpath=..").hover();
  expect(await topmost()).toBe(true);
  await shot(page, testInfo, "open-lesson-link-hover");
  await link.focus();
  await expect(link).toBeFocused();
  await shot(page, testInfo, "open-lesson-link-focus");
  await expect(link).toHaveAttribute("href", lessonPath);
});
