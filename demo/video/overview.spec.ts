import { test } from "playwright/test";
import { startRecording, type Director } from "./director";

/**
 * The member overview videos, recorded from the demo community (fictional people, seeded by demo/seed.ts):
 *
 *   overview-short  about 30 seconds: the promise and the loop, one beat per feature
 *   overview-long   about 2 minutes: the whole member experience, feature by feature
 *
 * `pnpm demo:video` records both into demo/out/video/ (WebM). They run against a production build of the demo app
 * (`pnpm demo:build`, then `pnpm demo:serve -p 3101`) so nothing compiles on camera; set DEMO_APP_URL to point
 * elsewhere. Captions are drawn into the page by the director, so the recording needs no editing.
 *
 * The long cut logs a real progress entry, so run `pnpm demo:seed` before recording: it puts the projects back as
 * they were, and the totals on screen stay the same from one recording to the next.
 */

const WARM = [
  "/dashboard",
  "/my-prickles",
  "/my-prickles/all",
  "/my-prickles/commitments",
  "/my-prickles/hosting",
  "/my-prickles/history",
  "/streaks",
  "/projects",
  "/chat",
  "/members",
  "/settings/notifications",
  "/help",
];

const sidebar = (d: Director, name: string) => d.page.getByRole("link", { name: new RegExp(name) }).first();
const tab = (d: Director, name: string) => {
  const exact = new RegExp(`^\\s*${name}\\s*$`);
  return d.page.getByRole("tab", { name: exact }).or(d.page.getByRole("button", { name: exact })).or(d.page.getByRole("link", { name: exact })).first();
};
const button = (d: Director, name: RegExp) => d.page.getByRole("button", { name }).first();
const project = (d: Director) => d.page.getByText("The Lighthouse Bakery Murders").first();
const channel = (d: Director, name: string) => d.page.getByRole("link", { name: new RegExp(`#${name}`) }).first();

test.use({ video: "off" });
test.setTimeout(600_000);

const baseURL = process.env.DEMO_APP_URL ?? "http://localhost:3101";

test("overview-short", async ({ browser }) => {
  const d = await startRecording(browser, baseURL, "member", WARM);
  await d.goto("/dashboard", 300);
  await d.card({ kicker: "Quill & Cup", title: "Hedgie Hub", line: "Your writing community, every day." }, 2200);
  await d.card(null);

  await d.say("See what's coming up, and who's writing with you", 1700);
  await d.click(sidebar(d, "Prickles"), 400);
  await d.click(tab(d, "All Prickles"), 400);
  await d.click(button(d, /^Calendar$/), 400);
  await d.say("Browse every Prickle on the calendar", 1600);
  await d.click(tab(d, "Commitments"), 400);
  await d.say("Commit to the ones that fit your week", 1600);

  await d.click(sidebar(d, "Streaks"), 400);
  await d.say("Keep your streak alive", 1800);

  await d.click(sidebar(d, "Writing"), 400);
  await d.click(project(d), 600);
  await d.say("Log your words and watch the book grow", 2300);

  await d.click(sidebar(d, "Chat"), 400);
  await d.click(channel(d, "craft-talk"), 600);
  await d.say("Talk craft with the whole community", 2300);

  await d.goto("/settings/notifications", 300);
  await d.say("Gentle reminders in Slack, email, or on your phone", 1900);

  await d.say("", 100);
  await d.card({ kicker: "Quill & Cup", title: "Write together.", line: "Join the Hedgie House." }, 2000);
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

  // Prickles: schedule, calendar, commitments, hosting, history.
  await d.click(sidebar(d, "Prickles"), 1000);
  await d.say("Prickles are focused writing sprints with fellow Hedgies, all day, every day", 3400);
  await d.click(tab(d, "All Prickles"), 1400);
  await d.say("The whole schedule, week by week", 2600);
  await d.click(button(d, /^Calendar$/), 1400);
  await d.say("Or see it laid out as a calendar", 3000);
  await d.say("", 300);

  await d.click(tab(d, "Commitments"), 1400);
  await d.say("Commit to the slots that fit your life, and add them to your own calendar", 4200);

  await d.click(tab(d, "Hosting"), 1400);
  await d.say("Settle in, then lead your own: hosting opens after your first month", 3800);

  await d.click(tab(d, "Attendance History"), 1400);
  await d.say("Every Prickle you've joined, with a check-in and check-out to reflect on how it went", 4200);
  await d.click(button(d, /^Month$/), 1200);
  await d.say("See your month at a glance", 3200);
  await d.click(button(d, /^Week$/), 900);
  // This week has nothing in it yet (it is the current one); last week shows what the view is for.
  await d.click(d.page.getByRole("button", { name: /^←$/ }).or(d.page.getByRole("link", { name: /^←$/ })).first(), 1000);
  // The week starts at midnight and the Prickles are in the morning: scroll the calendar to them.
  await d.page.getByRole("region", { name: "Week calendar" }).first().evaluate((el) => el.scrollTo({ top: 480, behavior: "smooth" }));
  await d.hold(900);
  await d.say("Or zoom into a week", 3000);
  await d.say("", 200);

  // Streaks.
  await d.click(sidebar(d, "Streaks"), 1200);
  await d.say("Streaks and badges celebrate showing up, week after week", 3400);
  await d.scroll(400, 1800);
  await d.say("", 200);

  // Writing: the projects, one project, and logging progress.
  await d.click(sidebar(d, "Writing"), 1400);
  await d.say("Every project in one place, from first idea to finished draft", 3600);
  await d.click(project(d), 1500);
  await d.say("Watch your progress build, day by day", 3600);
  await d.scroll(320, 1500);
  await d.say("", 200);
  await d.scroll(-320, 900);
  await d.click(button(d, /\+ Log progress/), 1200);
  await d.say("Logging a writing session takes seconds", 1800);
  await d.type(d.page.getByPlaceholder("e.g. 500"), "650", 500);
  await d.type(d.page.getByPlaceholder("What did you work on?"), "Chapter 14: the proofing room", 900);
  await d.click(d.page.locator('form button[type="submit"]').filter({ hasText: /Log progress/ }).first(), 1500);
  await d.say("Your totals, charts and streaks update instantly", 3400);
  await d.say("", 200);

  // Chat.
  await d.click(sidebar(d, "Chat"), 1400);
  await d.say("Chat with the whole community, right in the Hub", 3400);
  await d.click(channel(d, "craft-talk"), 1400);
  await d.say("Unread messages are easy to spot, and easy to catch up on", 3200);
  await d.click(d.page.getByText(/3 replies/).first(), 1500);
  await d.say("Follow a conversation in its thread, with reactions along the way", 4000);
  await d.say("", 200);
  await d.type(d.page.getByPlaceholder("Search messages"), "toast", 600);
  await d.page.keyboard.press("Enter");
  await d.hold(1500);
  await d.say("Everything is searchable, so no good advice is ever lost", 3600);
  await d.say("", 200);

  // Community.
  await d.click(sidebar(d, "Members"), 1400);
  await d.say("Meet the other Hedgies: bios, projects, what they love to talk about", 3400);
  await d.say("", 200);

  // Notifications and help.
  await d.page.goto("/settings/notifications", { waitUntil: "load" });
  await d.hold(800);
  await d.say("Gentle reminders where you already are: Slack, email, or your phone. You choose.", 3800);
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
