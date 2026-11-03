import { expect, shot, test } from "../fixtures";
import { demoChannelId } from "../video/slack-stand-in";

/**
 * How Slack's formatting looks in a chat message: inline `code` is red monospace on a light chip, a ``` block is a
 * bordered box of neutral monospace, as in Slack. Unit tests check the classes; this checks what the browser draws
 * (the computed colors and font, in light and dark), which jsdom, with no stylesheet, cannot.
 */
test("inline code is red monospace and a code block is a neutral bordered box", async ({ page, signInAs }, testInfo) => {
  await signInAs("member");
  await page.goto(`/chat/${await demoChannelId("craft-talk")}`);

  const inline = page.locator("code", { hasText: /^suddenly$/ });
  await inline.scrollIntoViewIfNeeded();
  const body = page.locator("p, div", { has: inline }).last();
  const bodyColor = await body.evaluate((el) => getComputedStyle(el).color);

  const inlineStyle = await inline.evaluate((el) => {
    const s = getComputedStyle(el);
    return { color: s.color, font: s.fontFamily, border: s.borderTopWidth };
  });
  expect(inlineStyle.font).toMatch(/mono/i);
  expect(inlineStyle.border).not.toBe("0px");
  expect(inlineStyle.color).not.toBe(bodyColor);
  // Red: the red channel dominates, so a theme change that greys it out fails here.
  const [r, g, b] = inlineStyle.color.match(/\d+/g)!.map(Number);
  expect(r).toBeGreaterThan(g + 60);
  expect(r).toBeGreaterThan(b + 60);

  const block = page.locator("pre", { hasText: "dark and stormy night" });
  await expect(block).toBeVisible();
  const blockStyle = await block.evaluate((el) => {
    const s = getComputedStyle(el.querySelector("code") ?? el);
    return { color: s.color, font: s.fontFamily, border: getComputedStyle(el).borderTopWidth };
  });
  expect(blockStyle.font).toMatch(/mono/i);
  expect(blockStyle.border).not.toBe("0px");
  expect(blockStyle.color).toBe(bodyColor);

  // The screenshot hides the caret by styling the composer, which must not happen before the page has hydrated.
  await page.waitForLoadState("networkidle");
  await shot(page, testInfo, "inline-code-and-block", { element: page.locator("p, div", { has: block }).last() });
});
