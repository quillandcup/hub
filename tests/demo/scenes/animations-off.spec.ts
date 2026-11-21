import { expect, shot, test } from "../fixtures";
import { demoChannelId } from "../video/slack-stand-in";

/**
 * Settings > Preferences > Animations (System, Allow, Reduce). Reduced, a GIF in chat is a still frame with a play button that the whole
 * picture toggles, and an animated custom emoji (a reaction) is a still; on, they move as before. This is easy to
 * break without noticing (a new image component, a new place emoji appear), so the scene checks the pictures
 * themselves, not just the setting.
 */
const STILL = /^data:image\/png/;
// A custom emoji is served from our own storage with a still PNG stored beside it (the emoji sync makes it).
const EMOJI_STILL = /\/slack-emoji\/[0-9a-f]+\.still\.png$/;
const EMOJI_MOVING = /\/slack-emoji\/[0-9a-f]+\.gif$/;

test("with animations off a GIF waits for play and an animated emoji is a still", async ({ page, signInAs }, testInfo) => {
  await signInAs("member");
  await page.addInitScript(() => window.localStorage.setItem("hub-animations", "reduce"));

  await page.goto(`/chat/${await demoChannelId("daily-wins")}`);
  const gif = page.getByAltText("party-disc.gif");
  await gif.scrollIntoViewIfNeeded();
  await expect(page.locator("html")).toHaveAttribute("data-animations", "off");

  // The attachment is its first frame, and nothing moves until someone presses play.
  await expect(gif).toHaveAttribute("src", STILL);
  const toggle = page.getByRole("button", { name: "Play party-disc.gif" });
  await expect(toggle).toBeVisible();

  // The animated emoji in the reactions is a still too, with no play button of its own.
  const emoji = page.getByRole("img", { name: ":party_disc:" }).first();
  await expect(emoji).toHaveAttribute("src", EMOJI_STILL);
  await expect(page.getByRole("button", { name: /play :party_disc:/i })).toHaveCount(0);
  await shot(page, testInfo, "paused");

  // Anywhere on the picture plays it (the real file again), and again pauses it (a still again).
  await toggle.click();
  await expect(page.getByRole("button", { name: "Pause party-disc.gif" })).toBeVisible();
  await expect(gif).toHaveAttribute("src", /\/api\/chat\/files\//);
  await shot(page, testInfo, "playing");

  // Regression: the pause icon was stuck over a playing GIF because clicking it left it focused and the icon also
  // showed on focus. It belongs to hover (and keyboard focus) only: gone with the mouse away, back on hover.
  // A touch screen has no hover, so there the icon stays (nothing else would say that a tap pauses).
  const icon = page.getByTestId("gif-state-icon");
  const away = (await page.evaluate(() => window.matchMedia("(hover: none)").matches)) ? "1" : "0";
  await expect(icon).toHaveText("❚❚");
  await page.mouse.move(2, 2);
  await expect(icon).toHaveCSS("opacity", away);
  await gif.hover();
  await expect(icon).toHaveCSS("opacity", "1");
  await page.mouse.move(2, 2);
  await expect(icon).toHaveCSS("opacity", away);
  // Paused, the play icon always shows.
  await page.getByRole("button", { name: "Pause party-disc.gif" }).click();
  await page.mouse.move(2, 2);
  await expect(icon).toHaveText("▶");
  await expect(icon).toHaveCSS("opacity", "1");
  await page.getByRole("button", { name: "Play party-disc.gif" }).click();
  await page.mouse.move(2, 2);
  await expect(icon).toHaveCSS("opacity", away);
  await page.getByRole("button", { name: "Pause party-disc.gif" }).click();
  await expect(gif).toHaveAttribute("src", STILL);
  await expect(page.getByRole("button", { name: "Play party-disc.gif" })).toBeVisible();

  // Expand still opens the picture larger.
  await page.getByRole("button", { name: "Expand party-disc.gif" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await shot(page, testInfo, "expanded");
  await page.keyboard.press("Escape");

  // Turned back on (as Settings does), the pictures are the real, moving files and there is no play button.
  await page.evaluate(() => {
    window.localStorage.setItem("hub-animations", "allow");
    window.dispatchEvent(new Event("hub-animations-changed"));
  });
  await expect(page.locator("html")).toHaveAttribute("data-animations", "on");
  await expect(gif).toHaveAttribute("src", /\/api\/chat\/files\//);
  await expect(emoji).toHaveAttribute("src", EMOJI_MOVING);
  await expect(page.getByRole("button", { name: /play party-disc\.gif/i })).toHaveCount(0);
  await shot(page, testInfo, "animations-on");
});

test("the Animations choice is in Settings > Preferences, defaults to System and is remembered", async ({ page, signInAs }, testInfo) => {
  await signInAs("member");
  await page.goto("/settings/preferences");
  const choice = page.getByRole("combobox", { name: "Animations" });
  await expect(choice).toHaveValue("system");
  await shot(page, testInfo, "system");

  await choice.selectOption("reduce");
  await expect(page.locator("html")).toHaveAttribute("data-animations", "off");
  await page.reload();
  await expect(page.getByRole("combobox", { name: "Animations" })).toHaveValue("reduce");
  await shot(page, testInfo, "reduced");

  // System puts it back to following the device (this browser does not ask for reduced motion).
  await page.getByRole("combobox", { name: "Animations" }).selectOption("system");
  await expect(page.locator("html")).toHaveAttribute("data-animations", "on");
  expect(await page.evaluate(() => window.localStorage.getItem("hub-animations"))).toBeNull();
});
