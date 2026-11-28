import { checkPage, expect, test } from "../fixtures";
import { WRITER_HANDLE, projectIdOf, restoreWriter, setupManyWorks, snapshotWriter, type WriterSnapshot } from "../milestone-demo";

/**
 * Page checks for the writing screens, with no screenshots: My Writing with works at several milestone levels and a title-only work
 * (Other works), a project's Milestones section and the answer form open, Settings, Profile (photo row, who-sees controls and the
 * writer profile block, with the flag on), My Books with the control on each book, the public Bookshelf as a visitor, and a writer
 * profile on the web as a visitor. Each page is opened and checked at every size and colour scheme like the pages of any scene, but
 * none is a help article or a changelog picture, so the nightly page checks (which skip `@published` and `@changelog`) visit them.
 * One invented writer (Rosa Demo, `regular2`), set up by tests/demo/milestone-demo.ts on the local demo stack and put back afterwards,
 * flag included, so no other scene sees her works.
 */
test.describe.configure({ mode: "serial" });

let before: WriterSnapshot;

test.beforeAll(async () => {
  before = await snapshotWriter();
  await setupManyWorks(true);
});

test.afterAll(async () => {
  await restoreWriter(before);
});

test.beforeEach(async ({ context }) => {
  await context.clearCookies();
});

test("My Writing: works at several milestone levels, and Other works", async ({ page, signInAs }, testInfo) => {
  await signInAs("regular2");
  await page.goto("/projects");
  await page.waitForLoadState("networkidle");
  const toggles = page.getByTestId("project-milestones").getByRole("button", { name: /Milestones/ });
  for (let i = (await toggles.count()) - 1; i >= 0; i--) await toggles.nth(i).click();
  await expect(page.locator('section[aria-labelledby="other-works"]')).toBeVisible();
  await checkPage(page, testInfo, "my-writing-milestones-open");

  // A work that is not listed: the title-only form under Other works.
  await page.locator('[data-track="milestone-add-unlisted-open"]').click();
  await expect(page.getByTestId("milestone-form-when")).toBeVisible();
  await checkPage(page, testInfo, "other-works-form-open");
});

test("A project page: its Milestones section and the answer form", async ({ page, signInAs }, testInfo) => {
  await signInAs("regular2");
  await page.goto(`/projects/${await projectIdOf("winter")}`);
  await page.waitForLoadState("networkidle");
  await expect(page.getByTestId("project-milestones-section")).toBeVisible();
  await checkPage(page, testInfo, "project-milestones");

  await page.locator('[data-track^="milestone-add-open"]').first().click();
  await expect(page.getByTestId("milestone-form-level")).toBeVisible();
  await checkPage(page, testInfo, "milestone-answer-form-open");
});

test("Settings, Profile: photo row, who-sees controls and the writer profile block", async ({ page, signInAs }, testInfo) => {
  await signInAs("regular2");
  await page.goto("/settings/profile");
  await page.waitForLoadState("networkidle");
  await expect(page.getByRole("checkbox", { name: /Show my profile on the web/ })).toBeVisible();
  await checkPage(page, testInfo, "settings-profile");
});

test("My Books: the control on each book, with its hint open", async ({ page, signInAs }, testInfo) => {
  await signInAs("member");
  await page.goto("/projects/books");
  await page.waitForLoadState("networkidle");
  const control = page.getByRole("button", { name: /Who can see this book/ }).first();
  await expect(control).toBeVisible();
  await control.hover();
  await checkPage(page, testInfo, "my-books-control");
});

test("The public Bookshelf, as a visitor who is not signed in", async ({ page, asVisitor }, testInfo) => {
  await asVisitor();
  await page.goto("/bookshelf");
  await page.waitForLoadState("networkidle");
  await expect(page.getByRole("heading", { level: 1, name: "The Hedgie Bookshelf" })).toBeVisible();
  await expect(page.getByRole("list", { name: "Books by our members" })).toBeVisible();
  await checkPage(page, testInfo, "public-bookshelf");
});

test("A writer profile on the web, as a visitor", async ({ page, asVisitor }, testInfo) => {
  await asVisitor();
  await page.goto(`/w/${WRITER_HANDLE}`);
  await page.waitForLoadState("networkidle");
  await expect(page.getByTestId("milestone-strip")).toBeVisible();
  await checkPage(page, testInfo, "writer-profile-web");
});
