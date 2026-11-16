import type { Locator, Page } from "playwright/test";
import { expect, shot, test } from "../fixtures";
import { DEMO_COURSE_SLUGS, DEMO_SHARED_LESSON } from "../courses-seed";
import { demoChannelId } from "../video/slack-stand-in";

/** What is under the middle of the element is the element: nothing (an overlay, a sibling) covers it, so it can be seen and clicked. */
const isTopmost = (target: Locator) =>
  target.evaluate((el) => {
    const box = el.getBoundingClientRect();
    const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
    return hit === el || el.contains(hit);
  });

/** Two boxes share no area. */
const apart = (a: { x: number; y: number; width: number; height: number }, b: { x: number; y: number; width: number; height: number }) =>
  a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y;

/** The demo has no Mux: answer the playback request with made-up links (the player itself can only show its error; what is under test is the app's own link). */
const stubPlayback = (page: Page, title: string, lessonHref: string) =>
  page.route(/\/api\/chat\/videos\/msg_[^/]+$/, (route) =>
    route.request().method() === "POST"
      ? route.fulfill({
          json: {
            title,
            lessonId: lessonHref.split("/").pop(),
            lessonHref,
            playbackId: "demo-playback",
            tokens: { playback: "demo", poster: "demo", storyboard: "demo" },
            restricted: false,
            record: false,
            resumeSeconds: 0,
          },
        })
      : route.fallback(),
  );

/**
 * The contrast of a control's text against what is really drawn behind it, from its pixels in a screenshot (axe cannot judge text over an image or
 * a blurred glass: it reports "incomplete"). Text is the brightest pixel, the ground the median one; WCAG's formula.
 */
async function measuredContrast(page: Page, target: Locator): Promise<number> {
  const png = (await target.screenshot({ animations: "disabled" })).toString("base64");
  return page.evaluate(async (src) => {
    const img = new Image();
    img.src = `data:image/png;base64,${src}`;
    await img.decode();
    const canvas = document.createElement("canvas");
    canvas.width = img.width;
    canvas.height = img.height;
    const g = canvas.getContext("2d")!;
    g.drawImage(img, 0, 0);
    const data = g.getImageData(0, 0, img.width, img.height).data;
    const lum = (r: number, gr: number, b: number) => {
      const f = (v: number) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
      return 0.2126 * f(r) + 0.7152 * f(gr) + 0.0722 * f(b);
    };
    const all: number[] = [];
    for (let i = 0; i < data.length; i += 4) all.push(lum(data[i], data[i + 1], data[i + 2]));
    all.sort((x, y) => x - y);
    const ground = all[Math.floor(all.length / 2)];
    const text = all[all.length - 1];
    return (Math.max(text, ground) + 0.05) / (Math.min(text, ground) + 0.05);
  }, png);
}

/** How the link's text is drawn: the player's container sets its own font and smoothing, and a label that differs between the card and the player looks bolder on click. */
const textStyle = (target: Locator) =>
  target.evaluate((el) => {
    const c = getComputedStyle(el);
    return [c.fontFamily, c.fontWeight, c.fontSize, c.letterSpacing, c.getPropertyValue("-webkit-font-smoothing")].join(" | ");
  });

/** A white lesson picture: the demo's own is a dark plum, and the case that matters is a white title slide. */
const BRIGHT_PICTURE = '<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720"><rect width="1280" height="720" fill="#ffffff"/></svg>';

/** The help article "Share a lesson video in chat": the copy-link row on a lesson, and the card it makes in a conversation. */
test("share a lesson video in chat", async ({ page, signInAs }, testInfo) => {
  await signInAs("member");
  await page.goto(`/courses/${DEMO_COURSE_SLUGS.current}`);
  await page.getByRole("link", { name: new RegExp(DEMO_SHARED_LESSON.title) }).first().click();
  const lessonPath = new URL(page.url()).pathname;
  await expect(page.getByRole("button", { name: "Copy link" })).toBeVisible();
  // Just the copy-link row: the demo has no real video, so the player above it can only show an error.
  await shot(page, testInfo, "copy-link", { element: page.getByRole("button", { name: "Copy link" }).locator("xpath=..") });

  await page.goto(`/chat/${await demoChannelId("craft-talk")}`);
  const card = page.getByRole("button", { name: new RegExp(`Play ${DEMO_SHARED_LESSON.title}`) });
  await expect(card).toBeVisible();
  await expect(card.locator("img")).toHaveJSProperty("complete", true);
  await card.scrollIntoViewIfNeeded();

  // Before anything is played the card already carries the way to the lesson (like YouTube's "Watch on YouTube"): opaque with no hover, the
  // topmost thing at its own centre (so it can be clicked), and clear of the card's big play square.
  const cardLink = page.getByRole("link", { name: "Open lesson" });
  await expect(cardLink).toBeVisible();
  await page.getByRole("heading", { name: /craft-talk/ }).hover();
  await expect(cardLink).toHaveCSS("opacity", "1");
  expect(await isTopmost(cardLink)).toBe(true);
  const [cardLinkBox, cardPlayBox] = await Promise.all([cardLink.boundingBox(), card.locator("span.bg-plum-600").boundingBox()]);
  if (cardLinkBox && cardPlayBox) expect(apart(cardLinkBox, cardPlayBox), "the card's link and its play square overlap").toBe(true);
  await shot(page, testInfo, "video-card");
  await cardLink.hover();
  await shot(page, testInfo, "video-card-link-hover");
  await cardLink.focus();
  await shot(page, testInfo, "video-card-link-focus");

  // The player opened: the "Open lesson" link over its corner. The demo has no Mux, so the playback request is answered with made-up
  // links (the player itself can only show its error); what is under test is the link, which is the app's own.
  await stubPlayback(page, DEMO_SHARED_LESSON.title, lessonPath);
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
  const topmost = () => isTopmost(link);
  expect(await topmost()).toBe(true);
  // It must not sit on the player's big play square (the button itself spans the whole frame; the label once ran into it on a phone).
  const [linkBox, playBox] = await Promise.all([link.boundingBox(), page.getByRole("button", { name: "Play video" }).locator("span").first().boundingBox()]);
  if (linkBox && playBox) expect(apart(linkBox, playBox), "the link and the play button overlap").toBe(true);

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

/**
 * Over a bright frame: the skin's own glass is white at 10%, so white text on it has almost no contrast on a white title slide. The link (and the
 * skin's pills beside it, which share the token) must stay readable on the card and in the open player, at every size and colour scheme.
 */
test("open lesson link over a bright frame", async ({ page, signInAs }, testInfo) => {
  await signInAs("member");
  await page.route(/\/api\/courses\/image\/lesson\//, (route) => route.fulfill({ contentType: "image/svg+xml", body: BRIGHT_PICTURE }));
  await page.goto(`/chat/${await demoChannelId("craft-talk")}`);
  const card = page.getByRole("button", { name: new RegExp(`Play ${DEMO_SHARED_LESSON.title}`) });
  await expect(card.locator("img")).toHaveJSProperty("complete", true);
  await card.scrollIntoViewIfNeeded();
  const link = page.getByRole("link", { name: "Open lesson" });
  await expect(link).toBeVisible();
  await page.getByRole("heading", { name: /craft-talk/ }).hover();
  await shot(page, testInfo, "bright-card");
  const cardText = await textStyle(link);
  const onCard = await measuredContrast(page, link);
  expect(onCard, "the link on the card over a bright picture").toBeGreaterThanOrEqual(4.5);

  await stubPlayback(page, DEMO_SHARED_LESSON.title, (await link.getAttribute("href")) ?? "");
  await card.click();
  await expect(page.getByRole("alertdialog")).toBeVisible();
  await page.getByRole("button", { name: "OK" }).click();
  await expect(page.getByRole("alertdialog")).toBeHidden();
  await page.getByRole("heading", { name: /craft-talk/ }).hover();
  await shot(page, testInfo, "bright-player");
  expect(await textStyle(link), "the link's text should be drawn the same in the player as on the card").toBe(cardText);
  const inPlayer = await measuredContrast(page, link);
  expect(inPlayer, "the link in the player over a bright picture").toBeGreaterThanOrEqual(4.5);
  // The pill must not change colour when the player takes the card's place (it did when it was see-through: the player darkens the picture behind it).
  expect(Math.abs(onCard - inPlayer) / Math.max(onCard, inPlayer), `the link's contrast on the card (${onCard.toFixed(1)}) and in the player (${inPlayer.toFixed(1)}) should match`).toBeLessThan(0.25);
});
