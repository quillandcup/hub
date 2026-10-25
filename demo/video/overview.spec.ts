import { test } from "playwright/test";
import { startRecording, type Director } from "./director";

/**
 * The member overview videos, recorded from the demo community (fictional people, seeded by demo/seed.ts):
 *
 *   overview-short  about 20 to 30 seconds: the one-line promise and the daily loop
 *   overview-long   about 90 to 150 seconds: the whole member experience, feature by feature
 *
 * `pnpm demo:video` records both into demo/out/video/ (WebM). They run against a production build of the demo app
 * (`pnpm demo:build`, then `pnpm demo:serve -p 3101`) so nothing compiles on camera; set DEMO_APP_URL to point
 * elsewhere. Captions are drawn into the page by the director, so the recording needs no editing.
 */

const WARM = [
  "/dashboard",
  "/my-prickles",
  "/my-prickles/all",
  "/my-prickles/commitments",
  "/my-prickles/hosting",
  "/streaks",
  "/projects",
  "/members",
  "/wheel-of-wonder",
  "/settings/notifications",
  "/help",
];

const sidebar = (d: Director, name: string) => d.page.getByRole("link", { name: new RegExp(name) }).first();
const tab = (d: Director, name: string) => {
  const exact = new RegExp(`^\\s*${name}\\s*$`);
  return d.page.getByRole("tab", { name: exact }).or(d.page.getByRole("button", { name: exact })).or(d.page.getByRole("link", { name: exact })).first();
};

test.use({ video: "off" });
test.setTimeout(600_000);

const baseURL = process.env.DEMO_APP_URL ?? "http://localhost:3101";

test("overview-short", async ({ browser }) => {
  const d = await startRecording(browser, baseURL, "member", WARM);
  await d.goto("/dashboard", 300);
  await d.card({ kicker: "Quill & Cup", title: "Hedgie Hub", line: "Your writing community, every day." }, 2600);
  await d.card(null);

  await d.say("See what's coming up, and who's writing with you", 600);
  await d.point(d.page.getByText("Progress Prickle").first(), 1500);

  await d.say("Find a Prickle and commit to the ones that fit", 300);
  await d.click(sidebar(d, "My Prickles"), 900);
  await d.click(tab(d, "Commitments"), 1700);

  await d.say("Keep your streak alive", 300);
  await d.click(sidebar(d, "Streaks"), 2300);

  await d.say("Track every word you write", 300);
  await d.click(sidebar(d, "My Writing"), 2600);

  await d.say("", 100);
  await d.card({ kicker: "Quill & Cup", title: "Write together.", line: "Join the Hedgie House." }, 2800);
  await d.finish("overview-short");
});

test("overview-long", async ({ browser }) => {
  const d = await startRecording(browser, baseURL, "member", WARM);
  await d.goto("/dashboard", 300);
  await d.card({ kicker: "Quill & Cup", title: "Hedgie Hub", line: "Everything you need to keep writing, in one place." }, 3600);
  await d.card(null);

  // Dashboard: the week ahead.
  await d.say("Your week at a glance: the Prickles coming up, who's hosting, who's coming", 3200);
  await d.point(d.page.getByText("Progress Prickle").first(), 2200);
  await d.say("", 200);

  // Find and commit.
  await d.click(sidebar(d, "My Prickles"), 1000);
  await d.say("Prickles are focused writing sprints with fellow Hedgies, all day, every day", 3400);
  await d.click(tab(d, "All Prickles"), 1400);
  await d.say("The whole schedule, week by week", 2600);
  await d.click(d.page.getByRole("button", { name: /^Calendar$/ }), 1400);
  await d.say("Or see it laid out as a calendar", 3000);
  await d.say("", 300);

  await d.click(tab(d, "Commitments"), 1400);
  await d.say("Commit to the slots that fit your life, and add them to your own calendar", 4200);

  await d.click(tab(d, "Hosting"), 1400);
  await d.say("Settle in, then lead your own: hosting opens after your first month", 3800);

  await d.click(tab(d, "Attendance History"), 1400);
  await d.say("Every Prickle you've joined, with a check-in and check-out to reflect on how it went", 4200);
  await d.say("", 200);

  // Streaks and progress.
  await d.click(sidebar(d, "Streaks"), 1200);
  await d.say("Streaks and badges celebrate showing up, week after week", 4200);
  await d.scroll(400, 1800);
  await d.say("", 200);

  await d.click(sidebar(d, "My Writing"), 1400);
  await d.say("Your projects, your progress: words, pages, chapters, whatever you count", 4200);
  await d.scroll(300, 1800);
  await d.say("", 200);

  // Community.
  await d.click(sidebar(d, "Members"), 1400);
  await d.say("Meet the other Hedgies: bios, projects, what they love to talk about", 4200);
  await d.say("", 200);

  // Search: anywhere, or anyone, in a second.
  const search = d.page.getByRole("button", { name: /Search pages/ }).or(d.page.getByPlaceholder(/Search pages/)).first();
  await d.click(search, 500);
  await d.say("Jump to any page, or any Hedgie, in a second", 600);
  await d.page.keyboard.type("Jules", { delay: 160 });
  await d.hold(2600);
  await d.page.keyboard.press("Escape");
  await d.say("", 300);

  // Notifications and help.
  await d.page.goto("/settings/notifications", { waitUntil: "load" });
  await d.hold(800);
  await d.say("Gentle reminders where you already are: Slack, email, or your phone. You choose.", 4600);
  await d.say("", 200);

  await d.page.getByRole("link", { name: /help/i }).first().click().catch(() => undefined);
  await d.hold(1200);
  await d.say("Questions? Hedgie Help explains how everything works", 3000);
  await d.click(d.page.locator('a[href^="/help/"]').first(), 1500);
  await d.say("Step-by-step guides, always up to date", 3000);
  await d.say("", 200);

  await d.card({ kicker: "Quill & Cup", title: "Write together.", line: "Show up. Write. Celebrate. Repeat." }, 3600);
  await d.finish("overview-long");
});
