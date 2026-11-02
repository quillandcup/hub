import { expect, shot, test } from "../fixtures";
import { demoChannelId } from "../video/slack-stand-in";

/**
 * Settings > Preferences > Allow animations. Off, a GIF in chat is a still frame with a play button that the whole
 * picture toggles, and an animated custom emoji (a reaction) is a still; on, they move as before. This is easy to
 * break without noticing (a new image component, a new place emoji appear), so the scene checks the pictures
 * themselves, not just the checkbox.
 */
const STILL = /^data:image\/png/;
// The chat page's own accessibility findings (avatar contrast, labels that differ from their text) predate this
// scene and no scene covered chat before, so its shots skip the page checks (docs/TODO.md, "Chat page checks in the demo").

test("with animations off a GIF waits for play and an animated emoji is a still", async ({ page, signInAs }, testInfo) => {
  await signInAs("member");
  await page.addInitScript(() => window.localStorage.setItem("hub-animations", "off"));

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
  await expect(emoji).toHaveAttribute("src", STILL);
  await expect(page.getByRole("button", { name: /play :party_disc:/i })).toHaveCount(0);
  await shot(page, testInfo, "paused", { checks: false });

  // Anywhere on the picture plays it (the real file again), and again pauses it (a still again).
  await toggle.click();
  await expect(page.getByRole("button", { name: "Pause party-disc.gif" })).toBeVisible();
  await expect(gif).toHaveAttribute("src", /\/api\/chat\/files\//);
  await shot(page, testInfo, "playing", { checks: false });

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
  await shot(page, testInfo, "expanded", { checks: false });
  await page.keyboard.press("Escape");

  // Turned back on (as Settings does), the pictures are the real, moving files and there is no play button.
  await page.evaluate(() => {
    window.localStorage.setItem("hub-animations", "on");
    window.dispatchEvent(new Event("hub-animations-changed"));
  });
  await expect(page.locator("html")).toHaveAttribute("data-animations", "on");
  await expect(gif).toHaveAttribute("src", /\/api\/chat\/files\//);
  await expect(emoji).toHaveAttribute("src", /party_disc\.gif$/);
  await expect(page.getByRole("button", { name: /play party-disc\.gif/i })).toHaveCount(0);
  await shot(page, testInfo, "animations-on", { checks: false });
});

test("the setting is in Settings > Preferences and is remembered", async ({ page, signInAs }, testInfo) => {
  await signInAs("member");
  await page.goto("/settings/preferences");
  const box = page.getByRole("checkbox", { name: /allow animations/i });
  await expect(box).toBeChecked();
  await shot(page, testInfo, "allowed");

  await box.uncheck();
  await expect(page.locator("html")).toHaveAttribute("data-animations", "off");
  await page.reload();
  await expect(page.getByRole("checkbox", { name: /allow animations/i })).not.toBeChecked();
  await shot(page, testInfo, "turned-off");

  await page.getByRole("checkbox", { name: /allow animations/i }).check();
  await expect(page.locator("html")).toHaveAttribute("data-animations", "on");
});
