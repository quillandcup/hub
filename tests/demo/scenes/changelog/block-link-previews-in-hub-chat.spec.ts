import { expect, shot, test } from "../../fixtures";
import { demoChannelId } from "../../video/slack-stand-in";

/** Screenshots for "Choose which sites show a preview in Hub Chat": the Remove preview question with its block choices, and the list of blocked sites in Settings (fictional demo community). */
test("a member is asked what to block when she removes a preview @changelog", async ({ page, signInAs }, testInfo) => {
  test.setTimeout(240_000);
  await signInAs("member");
  await page.goto(`/chat/${await demoChannelId("craft-talk")}`);
  const picture = page.locator('img[src*="/api/chat/unfurl-image"]').first();
  await expect(picture).toBeVisible();
  await picture.scrollIntoViewIfNeeded();
  await picture.hover();
  await page.getByRole("button", { name: "Remove preview" }).first().click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await shot(page, testInfo, "remove-preview");
});

test("her blocked sites are listed in Settings, each with a way to stop blocking @changelog", async ({ page, signInAs }, testInfo) => {
  test.setTimeout(240_000);
  await signInAs("member");
  await page.goto("/settings/preferences");
  const heading = page.getByRole("heading", { name: "Blocked link previews" });
  await expect(heading).toBeVisible();
  await expect(page.getByText("celebrity-gossip.example")).toBeVisible();
  await heading.scrollIntoViewIfNeeded();
  await shot(page, testInfo, "blocked-sites");
});
