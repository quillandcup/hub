import { expect, shot, test } from "../../fixtures";
import { WRITER_HANDLE, setupManyWorks, setupOneWork, writerMemberId } from "../../milestone-demo";

/**
 * Screenshots for the changelog entry "Show your writing milestones on your profile": one invented writer (Rosa Demo), first with
 * one work that gains its three milestones, then with several works at different phases. Each state is shown three ways: the
 * "Your milestones" card in her Settings, the Milestones strip other members see on her profile, and the strip a visitor sees on
 * her writer profile on the web. Everything is written to the local demo stack by tests/demo/milestone-demo.ts.
 */
test("a writer's milestones, in Settings, on her profile and on the web @changelog", async ({ page, signInAs, context }, testInfo) => {
  test.setTimeout(240_000);
  const rosaId = await writerMemberId();

  const card = () => page.locator('section[aria-labelledby="your-milestones"]');
  const strip = () => page.getByTestId("milestone-strip");
  /** A little room around what is cropped, so the last line is not on the edge of the picture. */
  const padded = async (el: ReturnType<typeof strip>) => el.evaluate((n) => ((n as HTMLElement).style.padding = "12px"));
  /** The app scrolls inside its main area, so a tall card is shot with a tall window, then the window goes back. */
  const tall = async <T,>(run: () => Promise<T>) => {
    const size = page.viewportSize();
    await page.setViewportSize({ width: size?.width ?? 1280, height: 3600 });
    try {
      return await run();
    } finally {
      if (size) await page.setViewportSize(size);
    }
  };

  /** Rosa's Settings card, as Rosa sees it. */
  const settings = async (name: string) => {
    await context.clearCookies();
    await signInAs("regular2");
    await page.goto("/settings/profile");
    await page.waitForLoadState("networkidle");
    await expect(card()).toBeVisible();
    await tall(() => shot(page, testInfo, name, { element: card() }));
  };

  /** Her profile as another member (Maya) sees it. */
  const profile = async (name: string) => {
    await context.clearCookies();
    await signInAs("member");
    await page.goto(`/members/${rosaId}`);
    await page.waitForLoadState("networkidle");
    await expect(strip()).toBeVisible();
    await padded(strip());
    await shot(page, testInfo, name, { element: strip() });
  };

  /** Her writer profile as a visitor who is not signed in sees it. */
  const web = async (name: string) => {
    await context.clearCookies();
    await page.goto(`/w/${WRITER_HANDLE}`);
    await page.waitForLoadState("networkidle");
    await expect(strip()).toBeVisible();
    await padded(strip());
    await shot(page, testInfo, name, { element: strip() });
  };

  // One work, one step at a time.
  await setupOneWork(1);
  await profile("one-work-1-the-end-profile");
  await settings("one-work-1-the-end-settings");
  await web("one-work-1-the-end-web");

  await setupOneWork(2);
  await profile("one-work-2-publish-ready-profile");
  await settings("one-work-2-publish-ready-settings");

  await setupOneWork(3);
  await profile("one-work-3-published-profile");
  await settings("one-work-3-published-settings");
  await web("one-work-3-published-web");

  // Several works at different phases of a book.
  await setupManyWorks();
  await profile("many-works-profile");
  await settings("many-works-settings");
  await web("many-works-web");

  // The one-time look at what will be public, right after the writer profile is switched on.
  await setupManyWorks(false);
  await context.clearCookies();
  await signInAs("regular2");
  await page.goto("/settings/profile");
  await page.waitForLoadState("networkidle");
  await page.getByRole("checkbox", { name: /Show my profile on the web/ }).click();
  await expect(page.getByRole("checkbox", { name: /Show my profile on the web/ })).toBeChecked({ timeout: 15_000 });
  await page.waitForLoadState("networkidle");
  const box = page.getByText("Your writer profile is on. Here is who sees what.").locator("xpath=..");
  await expect(box).toBeVisible();
  await tall(() => shot(page, testInfo, "switch-on-review", { element: box }));
});
