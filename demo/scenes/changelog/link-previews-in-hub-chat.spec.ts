import { expect, shot, test } from "../../fixtures";
import { demoChannelId } from "../../video/slack-stand-in";

/**
 * Screenshot for "Links in Hub Chat show a preview": the demo member's own message with a link, and the card under it
 * (title, description, picture) with the X in its corner, which only the message's author sees. The card is seeded
 * (demo/chat-seed.ts), because the demo can't run the fetch the server does after a send; its picture is a public-domain
 * photograph that the Hub's picture route fetches from Wikimedia, so this scene needs a network.
 */
test("a member sees the preview under a link they shared @changelog", async ({ page, signInAs }, testInfo) => {
  await signInAs("member");
  await page.goto(`/chat/${await demoChannelId("craft-talk")}`);
  await page.waitForLoadState("networkidle");
  await expect(page.getByText("research for my lighthouse bakery").first()).toBeVisible();
  const picture = page.locator('img[src*="/api/chat/unfurl-image"]').first();
  await expect(picture).toBeVisible();
  await expect.poll(() => picture.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true);
  // The card in the middle of the list, and the pointer on it: the X in its corner shows on hover, and only to the message's author.
  await picture.evaluate((img) => {
    img.scrollIntoView({ block: "center" });
    // A little further, so the author's name clears the date pill pinned at the top of the list.
    for (let el = img.parentElement; el; el = el.parentElement) {
      if (el.scrollHeight > el.clientHeight && getComputedStyle(el).overflowY.match(/auto|scroll/)) {
        el.scrollTop -= 60;
        break;
      }
    }
  });
  await picture.hover();
  await expect(page.getByRole("button", { name: "Remove preview" })).toBeVisible();
  await shot(page, testInfo, "preview-card");
});
