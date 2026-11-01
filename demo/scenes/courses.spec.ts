import { expect, shot, test } from "../fixtures";
import { DEMO_COURSE_SLUGS as SLUGS } from "../courses-seed";
import type { Page } from "playwright/test";

/** One h1 per page, which axe's WCAG tags don't ask for but a screen reader user navigates by. */
async function hasOneTitle(page: Page, name: string | RegExp) {
  // The tab title streams in after the page, and on a client-side navigation the previous page's stays until it does: wait for this page's own.
  await expect(page).toHaveTitle(typeof name === "string" ? new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")) : name);
  await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
}

/** Where the section's lessons are not beside the video, they follow it in a closed disclosure: open it so the checks see them. */
async function openSectionList(page: Page) {
  const summary = page.getByText("Lessons in this section", { exact: true }).filter({ visible: true });
  if (await summary.count()) await summary.first().click();
}

/** From the course outline, the way a member gets to any lesson (a lesson page lists only its own section's). */
async function openLesson(page: Page, title: RegExp) {
  await page.goto(`/courses/${SLUGS.current}`);
  await page.getByRole("link", { name: title }).first().click();
}

/** Colours that are still easing to their final value read as low contrast to axe; wait for every transition to end first. */
async function settled(page: Page) {
  await page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished.catch(() => undefined))));
}

/**
 * The member's courses: the list, a course outline with progress, a lesson with text and a download, a lesson whose
 * video is still being prepared, a module page, and the courses that are ended or not open yet. Every state a
 * member can be in, at every size and colour scheme (phones and tablets put the section list in a disclosure).
 */
test("a member finds their courses and opens a lesson, at any size", async ({ page, signInAs }, testInfo) => {
  await signInAs("member");

  await page.goto("/courses");
  await hasOneTitle(page, "Courses");
  await expect(page.locator("main").getByRole("heading", { level: 2 })).toHaveCount(3);
  await expect(page.getByRole("progressbar", { name: "Finish Your First Draft progress" })).toBeVisible();
  await shot(page, testInfo, "courses-list");

  await page.getByRole("heading", { level: 2, name: "Finish Your First Draft" }).getByRole("link").click();
  await hasOneTitle(page, "Finish Your First Draft");
  // Released lessons are links; "Coming soon" ones are not, and a draft is not there at all, not even its title.
  await expect(page.getByRole("link", { name: /How this course works/ }).first()).toBeVisible();
  await expect(page.getByText("Coming soon").first()).toBeVisible();
  await expect(page.getByRole("link", { name: /Celebrate small wins/ })).toHaveCount(0);
  await expect(page.getByText("Bonus interview")).toHaveCount(0);
  await expect(page.getByRole("progressbar", { name: "Course progress" })).toBeVisible();
  await shot(page, testInfo, "course-outline", { fullPage: true });

  // A lesson with text and a download.
  await openLesson(page, /How this course works/);
  await hasOneTitle(page, "How this course works");
  await expect(page.getByRole("region", { name: "Downloads" })).toBeVisible();
  await expect(page.getByRole("button", { name: /complete/i })).toHaveAttribute("aria-pressed", "true");
  await shot(page, testInfo, "lesson-text-and-download", { fullPage: true });

  // A lesson whose video is not playable yet says so, in a status others can hear.
  await openLesson(page, /Set a daily word goal/);
  await hasOneTitle(page, "Set a daily word goal");
  await expect(page.getByRole("status")).toContainText("still being prepared");
  await openSectionList(page);
  await shot(page, testInfo, "lesson-video-preparing", { fullPage: true });

  // ... and one whose video could not be prepared at all.
  await openLesson(page, /Protect your writing time/);
  await hasOneTitle(page, "Protect your writing time");
  await expect(page.getByRole("status")).toContainText("couldn't be prepared");
  await shot(page, testInfo, "lesson-video-errored");

  // The module page, from the breadcrumb.
  await page.getByRole("navigation", { name: "Breadcrumb" }).getByRole("link", { name: "Week 1: Plan your pages" }).click();
  await hasOneTitle(page, "Week 1: Plan your pages");
  await shot(page, testInfo, "module", { fullPage: true });
});

/** Marking a lesson complete is one shared control; it must say what it does to a screen reader, and undo cleanly. */
test("a member marks a lesson complete and takes it back", async ({ page, signInAs }, testInfo) => {
  await signInAs("member");
  await openLesson(page, /When the middle sags/);
  await hasOneTitle(page, "When the middle sags");

  const button = page.getByRole("button", { name: /complete/i });
  // The sizes run one after another against the same data, so start from "not complete" whatever the last run left.
  if ((await button.getAttribute("aria-pressed")) === "true") {
    await button.click();
    await expect(button).toHaveAttribute("aria-pressed", "false");
  }

  await button.click();
  await expect(button).toHaveAttribute("aria-pressed", "true");
  await settled(page);
  await shot(page, testInfo, "lesson-complete");

  await button.click();
  await expect(button).toHaveAttribute("aria-pressed", "false");
});

/** A course whose access ended keeps its progress and closes its lessons; one bought ahead of launch says when it opens. */
test("an ended course and one that has not opened yet say so, at any size", async ({ page, signInAs }, testInfo) => {
  await signInAs("member");

  await page.goto(`/courses/${SLUGS.ended}`);
  await hasOneTitle(page, "Outline Workshop");
  await expect(page.getByRole("status")).toContainText("Your access ended");
  await expect(page.getByRole("link", { name: /Find your story beats/ })).toHaveCount(0);
  await shot(page, testInfo, "course-ended", { fullPage: true });

  await page.goto(`/courses/${SLUGS.upcoming}`);
  await hasOneTitle(page, "Plot Like a Pro");
  await expect(page.getByText(/This course opens on/)).toBeVisible();
  await shot(page, testInfo, "course-not-open-yet");
});

/** Staff open every course and preview what members can't see yet: a draft says it is one. */
test("an admin sees every course and previews a draft lesson, at any size", async ({ page, signInAs }, testInfo) => {
  await signInAs("admin");

  await page.goto("/courses");
  await hasOneTitle(page, "Courses");
  await expect(page.locator("main").getByRole("heading", { level: 2 })).toHaveCount(3);
  await shot(page, testInfo, "admin-courses-list");

  await page.goto(`/courses/${SLUGS.current}`);
  await expect(page.getByText("Bonus interview").first()).toBeVisible();
  await shot(page, testInfo, "admin-course-outline", { fullPage: true });

  await page.getByRole("link", { name: /Bonus interview/ }).first().click();
  await hasOneTitle(page, /Bonus interview/);
  await expect(page.getByText(/this lesson is a draft/)).toBeVisible();
  await shot(page, testInfo, "admin-draft-preview", { fullPage: true });

  // "Coming soon" lessons open for staff too, as a preview.
  await page.goto(`/courses/${SLUGS.current}`);
  await page.getByRole("link", { name: /Celebrate small wins/ }).first().click();
  await hasOneTitle(page, "Celebrate small wins");
  await expect(page.getByText(/Coming soon/).first()).toBeVisible();
  await shot(page, testInfo, "admin-coming-soon-preview", { fullPage: true });
});
