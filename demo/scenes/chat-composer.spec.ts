import { expect, shot, test } from "../fixtures";
import { demoChannelId } from "../video/slack-stand-in";

type Rgba = [number, number, number, number];

/** WCAG relative luminance and contrast ratio of two opaque colours. */
function contrast(a: Rgba, b: Rgba): number {
  const lum = ([r, g, b]: Rgba) => {
    const [R, G, B] = [r, g, b].map((v) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * R + 0.7152 * G + 0.0722 * B;
  };
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

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
  // Start from an empty box: a draft saved by an earlier run (drafts are stored per conversation) would come back in it,
  // and pressing Quote on text that is already a quote takes the quote off.
  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.press("Backspace");
  const quote = page.locator(".ProseMirror blockquote");
  if (await quote.count()) await page.getByRole("button", { name: "Quote" }).click();
  await expect(quote).toHaveCount(0);

  await page.getByRole("button", { name: "Quote" }).click();
  await expect(quote).toHaveCount(1);
  await box.pressSequentially("Write drunk, edit sober.");
  await expect(quote).toHaveText("Write drunk, edit sober.");
  await shot(page, testInfo, "quote");

  // What the eye compares: the text and the bar against the surface behind them (the first opaque background up the tree).
  const colors = await page.locator(".ProseMirror blockquote").evaluate((el) => {
    const parse = (c: string): Rgba => (c.match(/[\d.]+/g) ?? ["0", "0", "0", "0"]).map(Number).concat(1).slice(0, 4) as Rgba;
    let surface: Rgba = [255, 255, 255, 1];
    for (let node: Element | null = el; node; node = node.parentElement) {
      const bg = parse(getComputedStyle(node).backgroundColor);
      if (bg[3] === 1) {
        surface = bg;
        break;
      }
    }
    const style = getComputedStyle(el);
    return { text: parse(style.color), bar: parse(style.borderLeftColor), surface };
  });
  // WCAG 2.1: 4.5:1 for text (1.4.3); 3:1 for the parts of a control that identify it (1.4.11).
  expect(contrast(colors.text, colors.surface), `quote text ${colors.text} on ${colors.surface}`).toBeGreaterThanOrEqual(4.5);
  expect(contrast(colors.bar, colors.surface), `quote bar ${colors.bar} on ${colors.surface}`).toBeGreaterThanOrEqual(3);
});
