import { expect, shot, test } from "../fixtures";
import type { Page } from "playwright/test";

// Short name on narrow calendars, full name on wide ones.
const DAYS = [["Sun", "Sunday"], ["Mon", "Monday"], ["Tue", "Tuesday"], ["Wed", "Wednesday"], ["Thu", "Thursday"], ["Fri", "Friday"], ["Sat", "Saturday"]] as const;

/**
 * Every day of the week has to be reachable. A week grid wider than the screen must scroll sideways to the rest;
 * if a container clips it instead, the last days are simply gone (as on a phone, where only Sunday to Wednesday
 * showed). Scrolling each day's header into view and finding it on screen is what a person does.
 */
async function everyDayCanBeReached(page: Page) {
  for (const [short, full] of DAYS) {
    const header = page.getByText(new RegExp(`^(${short}|${full})$`)).filter({ visible: true }).first();
    await header.scrollIntoViewIfNeeded();
    await expect(header, `${full} can be scrolled into view`).toBeInViewport({ ratio: 0.9 });
  }
}

/** The week calendars: All Prickles and My Attendance, at every size. */
test("the week calendars show every day, at any size", async ({ page, signInAs }, testInfo) => {
  await signInAs("member");

  await page.goto("/my-prickles/all");
  await page.getByRole("button", { name: "Calendar", exact: true }).click();
  await expect(page.getByText("Prev")).toBeVisible();
  await shot(page, testInfo, "all-prickles-calendar");
  await everyDayCanBeReached(page);
  await shot(page, testInfo, "all-prickles-calendar-saturday");

  await page.goto("/my-prickles/history");
  await page.getByRole("button", { name: "Week", exact: true }).click();
  await expect(page.getByText(/\w{3} \d{1,2} – \w{3} \d{1,2}, \d{4}/)).toBeVisible();
  await shot(page, testInfo, "my-attendance-week");
  await everyDayCanBeReached(page);
});
