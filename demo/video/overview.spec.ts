import { test } from "playwright/test";
import { startRecording, type Director } from "./director";
import { acknowledgePost, demoChannelId, forgetPosts } from "./slack-stand-in";
import { googleCalendarFrames } from "./google-calendar";
import { LONG as L, SHORT as S } from "./script";
import { LAST_CHAT_COOKIE } from "@/lib/chat/last-channel";

/**
 * The member overview videos, recorded from the demo community (fictional people, seeded by demo/seed.ts) and
 * narrated by the lines in script.ts (what is on screen for each beat: docs/OVERVIEW_VIDEO_SCRIPT.md):
 *
 *   overview-short  about 30 seconds: the promise and the loop, one beat per feature
 *   overview-long   about 2.5 minutes: the whole member experience, feature by feature
 *
 * `pnpm demo:video` records both into demo/out/video/ (WebM and MP4, with the voice). They run against a production
 * build of the demo app (`pnpm demo:build`, then `pnpm demo:serve -p 3101`) so nothing compiles on camera; set
 * DEMO_APP_URL to point elsewhere. Captions are the spoken lines, drawn into the page by the director, so the
 * recording needs no editing.
 *
 * Each beat is `d.narrate(line, actions)`: the line is spoken while the actions happen, and the screen waits for
 * whichever takes longer. The long cut logs a real progress entry, so run `pnpm demo:seed` before recording: it
 * puts the projects back as they were, and the totals on screen stay the same from one recording to the next.
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

/** Write a message in the open channel and send it; the demo has no Slack, so the recording plays Slack's answer. */
async function post(d: Director, text: string) {
  await d.type(d.page.getByPlaceholder(/^Message #/), text, 300);
  await d.click(d.page.getByRole("button", { name: /^Send$/ }), 600);
  await acknowledgePost(text);
  await d.hold(1000);
}

test.use({ video: "off" });
test.setTimeout(600_000);

const baseURL = process.env.DEMO_APP_URL ?? "http://localhost:3101";

/** A returning member: signed in, with the chat channel they last had open (so /chat opens on it, not the empty list). */
async function startAsMember(browser: Parameters<typeof startRecording>[0]) {
  await forgetPosts();
  const lastChannel = await demoChannelId("announcements");
  return startRecording(browser, baseURL, "member", WARM, "light", [{ name: LAST_CHAT_COOKIE, value: lastChannel }]);
}

test("overview-short", async ({ browser }) => {
  const d = await startAsMember(browser);
  await d.goto("/dashboard", 300);
  await d.card({ kicker: "Quill & Cup", title: "Hedgie Hub", line: "Your writing community, every day." }, 100);
  await d.narrate(S.hook);
  await d.card(null);

  await d.narrate(S.meet);
  await d.narrate(S.commit, async () => {
    await d.click(sidebar(d, "Prickles"), 400);
    await d.click(tab(d, "Commitments"), 400);
  });
  await d.narrate(S.streaks, () => d.click(sidebar(d, "Streaks"), 600));
  await d.narrate(S.log, async () => {
    await d.click(sidebar(d, "Writing"), 400);
    await d.click(project(d), 600);
  });
  await d.narrate(S.chat, async () => {
    await d.click(sidebar(d, "Chat"), 400);
    await d.click(channel(d, "prickle-chatter"), 500);
    await post(d, "I'm in for tonight!");
  });

  await d.card({ kicker: "Quill & Cup", title: "Write together.", line: "Join the Hedgie House." }, 100);
  await d.narrate(S.close);
  await d.finish("overview-short");
});

test("overview-long", async ({ browser }) => {
  const d = await startAsMember(browser);
  await d.goto("/dashboard", 300);
  await d.card({ kicker: "Quill & Cup", title: "Hedgie Hub", line: "Everything you need to keep writing, in one place." }, 100);
  await d.narrate(L.hook);
  await d.card(null);

  // The dashboard, scrolled down to what is coming up.
  await d.narrate(L.meet);
  await d.narrate(L.upcoming, () => d.scroll(520, 600));

  // Prickles: add one to the calendar, commit and sync, and what Google then shows.
  await d.narrate(L.prickles, async () => {
    await d.click(sidebar(d, "Prickles"), 700);
    await d.click(d.page.getByTitle("Add to my calendar").first(), 800);
    await d.click(d.page.getByText(/Just this one/).first(), 1000);
  });
  await d.narrate(L.commit, async () => {
    await d.click(tab(d, "Commitments"), 900);
    await d.point(d.page.getByRole("link", { name: "Google Calendar" }), 600);
  });
  // What that looks like in Google Calendar (stills from a real account, made by hand; skipped when they aren't there).
  const google = googleCalendarFrames();
  if (google) {
    await d.narrate(L.googleWeek, () => d.showHtml(google.week, 300));
    await d.narrate(L.googleEvent, () => d.showHtml(google.event, 300));
    await d.goto("/my-prickles/commitments", 1500);
  }

  // Attendance history: the list, then the month and a week.
  await d.narrate(L.history, async () => {
    await d.click(tab(d, "Attendance History"), 1200);
    await d.click(button(d, /^Month$/), 1800);
    await d.click(button(d, /^Week$/), 900);
    // This week has nothing in it yet (it is the current one); last week shows what the view is for.
    await d.click(d.page.getByRole("button", { name: /^←$/ }).or(d.page.getByRole("link", { name: /^←$/ })).first(), 1000);
    // The week starts at midnight and the Prickles are in the morning: scroll the calendar to them.
    await d.page.getByRole("region", { name: "Week calendar" }).first().evaluate((el) => el.scrollTo({ top: 480, behavior: "smooth" }));
    await d.hold(1200);
  });

  await d.narrate(L.streaks, () => d.click(sidebar(d, "Streaks"), 1500));

  // Writing: the projects, one project, and logging progress.
  await d.narrate(L.projects, () => d.click(sidebar(d, "Writing"), 1200));
  await d.narrate(L.log, async () => {
    await d.click(project(d), 1500);
    await d.click(button(d, /\+ Log progress/), 1000);
    await d.type(d.page.getByPlaceholder("e.g. 500"), "650", 400);
    await d.type(d.page.getByPlaceholder("What did you work on?"), "Chapter 14: the proofing room", 700);
    await d.click(d.page.locator('form button[type="submit"]').filter({ hasText: /Log progress/ }).first(), 1500);
  });

  // Chat.
  await d.narrate(L.chat, () => d.click(sidebar(d, "Chat"), 1200));
  await d.narrate(L.unread, () => d.click(channel(d, "craft-talk"), 1200));
  await d.narrate(L.thread, () => d.click(d.page.getByText(/3 replies/).first(), 1200));
  await d.narrate(L.post, async () => {
    await d.click(channel(d, "prickle-chatter"), 1000);
    await post(d, "Count me in for tonight's Sprint Prickle!");
  });
  await d.narrate(L.search, async () => {
    await d.type(d.page.getByPlaceholder("Search messages"), "toast", 500);
    await d.page.keyboard.press("Enter");
    await d.hold(1500);
  });

  // Community.
  await d.narrate(L.members, () => d.click(sidebar(d, "Members"), 1200));

  // Notifications, reached the way a member would: the user menu, Settings, the Notifications tab.
  await d.narrate(L.reminders, async () => {
    await d.click(d.page.getByRole("button", { name: /Maya/ }).first(), 700);
    await d.click(d.page.getByRole("link", { name: /^Settings$/ }), 500);
    // The settings tab, not the bell in the header that has the same name.
    const inPage = d.page.locator("main");
    const notificationsTab = inPage.getByRole("tab", { name: /^Notifications$/ }).or(inPage.getByRole("button", { name: /^Notifications$/ })).or(inPage.getByRole("link", { name: /^Notifications$/ }));
    await d.click(notificationsTab.first(), 1200);
  });

  await d.narrate(L.help, async () => {
    await d.click(d.page.getByRole("link", { name: /help/i }).first(), 1000);
    await d.click(d.page.locator('a[href^="/help/"]').first(), 1200);
  });

  await d.card({ kicker: "Quill & Cup", title: "Write together.", line: "Show up. Write. Celebrate. Repeat." }, 100);
  await d.narrate(L.close);
  await d.finish("overview-long");
});
