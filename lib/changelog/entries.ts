/**
 * The Hedgie Hub changelog: one entry per release a member would notice, newest first or not (the
 * helpers sort). This file is the single source: the in-app pages (/changelog), the generated
 * CHANGELOG.md (`pnpm changelog:generate`, checked by a test) and the "What's new" digest all read it.
 * Written for members: say what they can now do, not what changed in the code. See docs/CHANGELOG_PROCESS.md.
 *
 * Screenshots live in public/changelog/<slug>/ (the repo and that folder are public: no member data in
 * them) and are written in `body` as `![alt](/changelog/<slug>/<file>.png)`. `image` is the one shown on
 * the list, the digest and the Slack post.
 */

export const CHANGELOG_CATEGORIES = {
  new: "New",
  improved: "Improved",
  fixed: "Fixed",
} as const;

export type ChangelogCategory = keyof typeof CHANGELOG_CATEGORIES;

/**
 * Who an entry is for. `product` entries are what members see: the What's new pages, the weekly digest, the
 * announcements post, and CHANGELOG.md. `engineering` entries (platform improvements, or the lower-level detail behind
 * a product update) appear only in CHANGELOG.md, with their body, and have no page or notification.
 */
export const CHANGELOG_AUDIENCES = {
  product: "Product",
  engineering: "Engineering",
} as const;

export type ChangelogAudience = keyof typeof CHANGELOG_AUDIENCES;

export interface ChangelogEntry {
  /** The permalink (`/changelog/<slug>`): lowercase words and hyphens. Never changed once published, so shared links keep working. */
  slug: string;
  /** The day it shipped, YYYY-MM-DD (Eastern). */
  date: string;
  audience: ChangelogAudience;
  category: ChangelogCategory;
  title: string;
  /** One or two plain sentences (no markdown): the excerpt in the list, the digest and the Slack post. */
  summary: string;
  /** The full write-up in markdown: images as `/changelog/<slug>/<file>`, links to Hub pages as `/path`. */
  body: string;
  /** A screenshot shown with the summary: a path under /changelog/<slug>/. */
  image?: { src: string; alt: string };
}

export const CHANGELOG_ENTRIES: readonly ChangelogEntry[] = [
  {
    slug: "personal-calendar-feed-and-commitments",
    date: "2026-09-27",
    audience: "product",
    category: "new",
    title: "Your prickles in your own calendar, and commitments across several slots",
    summary:
      "Subscribe to a private calendar feed of the prickles you host, commit to or add by hand, and make a commitment that covers more than one weekly slot.",
    body: [
      "Each member now has a private calendar link that works with Google Calendar, Apple Calendar and Outlook. It shows the prickles you host, the ones you have committed to, and any prickle or event you add yourself, with a 15 minute reminder.",
      "On /my-prickles you will find the calendar card, with copy link and generate new link. Use Add to my calendar on a prickle row, a prickle page or an upcoming event to add just that one or every week.",
      "A commitment can now cover several slots. In All Prickles, tick the times you want, then pick the weeks and a start date. The Commitments tab shows your progress on each slot.",
    ].join("\n\n"),
  },
  {
    slug: "member-directory-and-profile-notes",
    date: "2026-09-28",
    audience: "product",
    category: "new",
    title: "Member directory, Ask me about topics and private notes",
    summary:
      "Search the Hedgies in the new Members page, share what you love to talk about on your profile, and jot private notes about people you meet.",
    body: [
      "The /members page lists current Hedgies with their bio, Ask me about topics and the writing projects they chose to show on their profile. Search matches names, bios, projects, topics and your own notes, and clicking a topic searches for it.",
      "Add your own Ask me about topics under Profile in Settings (/settings/profile).",
      "On someone else's profile you now have a My notes card for things you want to remember. Only you can see your notes.",
    ].join("\n\n"),
  },
  {
    slug: "writing-goal-titles-and-status",
    date: "2026-09-28",
    audience: "product",
    category: "improved",
    title: "Writing goals: titles, profile visibility and clearer status",
    summary:
      "Goals can have a title and description, and you choose whether each shows on your profile. Finished goals now say Achieved or Ended instead of Behind pace.",
    body: [
      "- Give a writing goal a title and a description. Both show on its card.",
      "- Choose Show on my profile for each goal and project. Your profile lists every one you chose to show.",
      "- A goal that reaches its target says Achieved, and one whose end date passed without reaching it says Ended. Pace is only shown while a goal is active.",
      "- Fixed: other members could not see the project you chose to show on your profile.",
    ].join("\n"),
  },
  {
    slug: "sign-in-from-slack",
    date: "2026-09-29",
    audience: "product",
    category: "new",
    title: "Sign in to the Hub from Slack",
    summary:
      "Open the Hedgie Hub straight from Slack, without waiting for an email link.",
    body: [
      "Billie Bot's Home tab in Slack, and its /hub command, give you an Open Hedgie Hub button that signs you in. Each link works once and lasts about an hour.",
      "Slack on iPhone opens links in its own browser, so you can also ask for a link to copy and open in Safari, or paste the code on the login page.",
      "Sign-in links sent by email now stay valid for 24 hours, and an invited person who asks for a link gets the invite again.",
    ].join("\n\n"),
  },
  {
    slug: "check-ins-and-prickle-picker",
    date: "2026-10-02",
    audience: "product",
    category: "new",
    title: "Prickle check-ins and a Prickle Picker that learns from them",
    summary:
      "Say how you feel and what you need before a prickle and how it went afterwards. The Prickle Picker uses your answers to suggest prickles that suit you.",
    body: [
      "Every prickle page has a Check in card. Pick up to two feelings for how you are coming in and one thing you need, such as momentum, deep focus, accountability, company or a push to get unstuck. Once the prickle has started you can also rate how it went and how you feel now. Every question is optional, and only you and the Hub admins can see your answers.",
      "The Prickle Picker now starts with How are you feeling? Your answer suggests a mood and the picks follow. Once you have rated at least two similar sessions, it also favors the kinds of prickle you rated higher than your usual.",
    ].join("\n\n"),
  },
  {
    slug: "link-writing-to-prickles",
    date: "2026-10-02",
    audience: "product",
    category: "improved",
    title: "Link your writing progress to the prickle you wrote in",
    summary:
      "When you log progress you can say which prickle it was during, and your dashboard reminds you about writing prickles you have not logged.",
    body: [
      "- The Log Progress window has a During which prickle? picker for the prickles on that day. If you attended just one, it is chosen for you.",
      "- A prickle page shows Your writing in this prickle, and project pages show which prickle an entry was written during.",
      "- If you have a writing project, your dashboard has a What did you write? card listing recent prickles with nothing logged. Log from it, or use the x to dismiss one you would rather skip.",
      "- Fixed: an evening prickle no longer defaults the entry to the next day.",
    ].join("\n"),
  },
  {
    slug: "check-in-and-check-out-dms",
    date: "2026-10-03",
    audience: "product",
    category: "new",
    title: "Check-in and check-out reminders from Billie Bot",
    summary:
      "Billie Bot now asks how you are feeling shortly before a prickle and how it went afterwards, and you choose where those messages arrive.",
    body: [
      "Before a prickle you get a short message asking how you are feeling coming in, and afterwards one asking how it went. Each links to the check-in or check-out itself.",
      "Choose which messages you get, and whether they come by Slack or in the Hub, under Notifications in Settings (/settings/notifications). Check-out is available on the prickle page once the prickle starts.",
      "The Slack bot is now named Billie Bot (Hedgie Hub), so searching for hub finds it.",
    ].join("\n\n"),
  },
  {
    slug: "getting-started-tour",
    date: "2026-10-03",
    audience: "product",
    category: "new",
    title: "A Getting started tour for new members",
    summary:
      "A checklist walks new members through setting up their details, introducing themselves, setting a writing goal and finding a prickle.",
    body: [
      "A Getting started checklist appears in the corner of the page for accounts under 30 days old. At each step a spotlight shows you the setting to use. Check your details covers your name, birthday, pen names and other email addresses.",
      "Finished steps can be revisited, and you can restart the tour from the user menu.",
    ].join("\n\n"),
  },
  {
    slug: "in-the-hub-notifications",
    date: "2026-10-03",
    audience: "product",
    category: "new",
    title: "Notifications inside the Hub",
    summary:
      "A bell in the header and a notifications inbox keep your check-ins and other messages in the Hub, with a banner for anything time sensitive.",
    body: [
      "Messages can now arrive In the Hub as well as Slack: a bell in the header with the latest few, and a full list at /notifications. A banner appears for what is worth acting on right now, such as a check-in before the prickle starts.",
      "A notification counts as read once you open it, dismiss its banner or answer it. You can mark messages unread again and use Edit multiple to mark many as read or unread.",
    ].join("\n\n"),
  },
  {
    slug: "week-2026-10-03-small-fixes",
    date: "2026-10-03",
    audience: "product",
    category: "fixed",
    title: "Small fixes and polish",
    summary:
      "A handful of fixes to sign-in, notification settings and the dashboard.",
    body: [
      "- Members whose login email differs from the email on their membership can save changes again.",
      "- On the sign-in screen, duplicate Slack paste controls are merged, and the iPhone instructions lead with what to do on an iPhone.",
      "- Notification channels show as logo toggles in each row.",
      "- On your dashboard, the project title is larger than the goal in Writing Goals.",
      "- Settings pages now have their own addresses, such as /settings/notifications.",
    ].join("\n"),
  },
  {
    slug: "check-in-from-attendance-history",
    date: "2026-10-04",
    audience: "product",
    category: "improved",
    title: "Check in and out from your attendance history",
    summary:
      "Attendance History now has check-in and check-out buttons for each prickle, and Find a Prickle always gives you something to consider.",
    body: [
      "- Each row in Attendance History at /my-prickles/history has Check in and Check out buttons, and upcoming prickles have a Check in button. Checking out also lets you log progress for your projects.",
      "- The check-out has a star rating, and the progress questions take numbers.",
      "- Attendance History opens as a list, 25 rows at a time.",
      "- Find a Prickle always suggests something, and says what does not match what you asked for. The feelings question now comes last and is optional.",
    ].join("\n"),
  },
  {
    slug: "week-2026-10-05-fixes",
    date: "2026-10-05",
    audience: "product",
    category: "fixed",
    title: "Small fixes and polish",
    summary:
      "Fractional amounts, check-out links and a lighter set of check-in options.",
    body: [
      "- Progress and goal amounts can now be fractions.",
      "- The check-out message links to the check-out, not the check-in.",
      "- Check-in options were trimmed: fewer feelings, and Gentle is folded into Company.",
      "- Slack messages from Billie Bot no longer show a big link preview card.",
    ].join("\n"),
  },
  {
    slug: "email-notifications",
    date: "2026-10-10",
    audience: "product",
    category: "new",
    title: "Get notifications by email",
    summary:
      "You can now choose email for any kind of Hub message, and every email has an unsubscribe link.",
    body: [
      "Under Notifications in Settings (/settings/notifications), turn on email for the messages you want. Email is off until you choose it. Each email has a link to stop that kind of message.",
    ].join("\n\n"),
  },
  {
    slug: "hub-chat-first-look",
    date: "2026-10-10",
    audience: "product",
    category: "new",
    title: "Hub chat, a first look",
    summary:
      "Read our Slack channels in the Hub, post and react from there, and optionally connect your Slack account so your messages go out as you.",
    body: [
      "Chat at /chat shows the Slack channels you are in, plus public ones, with a pinned channel list, unread counts, a New messages line, a side panel for the person you are reading and a phone layout. Conversations update live.",
      "You can write messages and replies in the Hub and they appear in Slack. By default Billie Bot posts them with your name and photo. If you connect your Slack account under Account in Settings, they go out as you.",
      "You can react to messages too. Reactions made from the Hub show in Slack only if you have connected your Slack account.",
    ].join("\n\n"),
  },
  {
    slug: "notification-framework",
    date: "2026-10-03",
    audience: "engineering",
    category: "new",
    title: "Notification framework with per-kind channels",
    summary:
      "Automatic messages go through one framework with per-kind, per-channel settings for each member.",
    body: [
      "Each kind of message is registered in lib/notifications/registry.ts and sent through createNotifier in lib/notifications/notify.ts, which honors member opt-outs. Delivery adapters live in lib/channels/ (Slack, then in-app and email). A message can be marked time sensitive until a given time, and each channel decides what that means. Admin Test Notifications sends every kind on every channel. Related product entries: check-in and check-out messages, notifications inside the Hub, and email notifications.",
    ].join("\n\n"),
  },
  {
    slug: "env-config-layering",
    date: "2026-10-02",
    audience: "engineering",
    category: "improved",
    title: "Config split between app.config.ts and layered env files",
    summary:
      "Shared deployment config moved into a committed app config, and secrets are layered across shared, preview and production env files.",
    body: [
      "Values that are the same everywhere live in app.config.ts and are read through lib/config.ts. Secrets use .env.shared with .env.preview and .env.prod overrides, synced by the env:sync scripts. Analytics tracking is production only, and Sentry events are tagged by environment.",
    ].join("\n\n"),
  },
  {
    slug: "slack-manifest-from-ci",
    date: "2026-10-02",
    audience: "engineering",
    category: "improved",
    title: "Slack app manifest pushed from CI",
    summary:
      "The Slack app configuration is now code, pushed after each production deploy when it changes.",
    body: [
      "slack-app-manifest.yml is the source of truth and scripts/slack-manifest.ts pushes it after the production deploy, and only when it has changed.",
    ].join("\n\n"),
  },
  {
    slug: "activity-log-and-audit",
    date: "2026-10-06",
    audience: "engineering",
    category: "new",
    title: "Audit log and central Activity Log",
    summary:
      "Admin changes and member actions are recorded in one audit log with readable rows and per-record history.",
    body: [
      "The Activity Log page is admin only. The audit log records the net effect of a transaction rather than every intermediate write, and has a Hide system toggle. See docs/ACTIVITY_AND_AUDIT_LOG.md.",
    ].join("\n\n"),
  },
  {
    slug: "slack-bronze-capture",
    date: "2026-10-07",
    audience: "engineering",
    category: "improved",
    title: "Richer Slack capture with soft deletes",
    summary:
      "Group DMs, channel membership history, custom emoji and files are captured, deletions are marked rather than removed, and Slack message content is service role only.",
    body: [
      "Slack Bronze tables use a deleted_at column for removed messages and reactions, and aging out of the import window is never treated as deletion. Message text is readable only with the service role, admins read metadata through a view, and restricted channels are managed by admins. Activities rebuild one week per call to stay inside the statement timeout.",
    ].join("\n\n"),
  },
  {
    slug: "chat-mirror-tables",
    date: "2026-10-09",
    audience: "engineering",
    category: "new",
    title: "Chat mirror tables and live updates",
    summary:
      "A mirror of Slack conversations is projected from Bronze and updated live over Realtime, with posting back to Slack through an outbox.",
    body: [
      "Row-level security gates content separately from channel metadata. Posts from the Hub go to Slack through an outbox with retries, and are credited to their author in activity and Wheel of Wonder. See docs/SLACK_BRIDGED_CHAT.md and the Hub chat product entry.",
    ].join("\n\n"),
  },
{
    slug: "chat-sends-as-you",
    date: "2026-10-11",
    audience: "product",
    category: "new",
    title: "Hub chat can send as you",
    summary:
      "Connect your Slack account in Settings and the messages and reactions you send from Hub chat show up in Slack as you.",
    body: [
      "Connect your Slack account under Settings, Account. After that, what you post or react with in Hub chat appears in Slack under your own name instead of through our bot. You can disconnect at any time from the same place.",
      "A message that Slack has not accepted after a few retries is marked as failed, so you can see it did not go through.",
    ].join("\n\n"),
  },
  {
    slug: "chat-live-updates",
    date: "2026-10-12",
    audience: "product",
    category: "improved",
    title: "Chat feels faster and stays current",
    summary:
      "A message you send shows up the moment you press Send, and open conversations and threads update without reloading.",
    body: [
      "- Your message appears right away, then is confirmed once Slack has it.",
      "- Slack reactions on messages show up at once, and a reaction you take back in Slack goes away here too.",
      "- An open conversation or thread picks up new messages by itself.",
    ].join("\n"),
  },
  {
    slug: "instagram-and-profile-links",
    date: "2026-10-12",
    audience: "product",
    category: "improved",
    title: "Instagram on your profile",
    summary:
      "The Instagram field in Settings is now a link like Facebook and X, and it shows the handle your profile really links to.",
    body: [
      "Under Settings, Profile, the Instagram field shows the handle your profile points to. Clear the field and the handle comes off your profile and the directory.",
    ].join("\n\n"),
  },
  {
    slug: "universal-search",
    date: "2026-10-15",
    audience: "product",
    category: "new",
    title: "Search everything from the header",
    summary:
      "Search the Hub from the header to find members, prickles, events, pages and each settings section, with filters you can type.",
    body: [
      "Press the search box in the header (or Cmd or Ctrl K) to find members, prickles, events, pages and each section of Settings. Filters such as from: narrow results to one person, and you can limit by kind or by how recent something is. The filter bar is one compact row that wraps on a small screen instead of scrolling sideways.",
      "Recent searches can be removed with the x. On phones the search fills the screen, and a full results page is at /search.",
    ].join("\n\n"),
  },
  {
    slug: "whos-coming-to-prickles",
    date: "2026-10-15",
    audience: "product",
    category: "new",
    title: "See who is coming to upcoming prickles",
    summary:
      "An upcoming prickle now shows who is planning to be there, and you can choose not to be listed.",
    body: [
      "On a prickle that has not started, the page shows Who's coming: the host, plus members who committed to it or added it to their calendar. It is a friendly sign of who is planning to join, not a reservation.",
      "Prefer not to be listed? Turn it off under Settings, Profile. You will still see yourself, marked as hidden from others. A prickle nobody has joined yet says to stay tuned instead of showing a zero.",
    ].join("\n\n"),
  },
  {
    slug: "add-to-calendar-from-upcoming",
    date: "2026-10-15",
    audience: "product",
    category: "improved",
    title: "Add a prickle to your calendar from the Upcoming list",
    summary:
      "Each prickle in My Prickles, Upcoming has a calendar icon, so you no longer have to open it first.",
    body: [
      "The icon opens the same menu as the prickle page: just this one, or every week. A prickle you host or committed to shows why it is already on your calendar. Find it in [My Prickles](/my-prickles).",
    ].join("\n\n"),
  },
  {
    slug: "getting-started-newcomer-steps",
    date: "2026-10-15",
    audience: "product",
    category: "improved",
    title: "Getting started: steps for newcomers",
    summary:
      "The Getting started tour now has steps for saying hello, scheduling your first prickle and syncing your calendar, and it is on for everyone.",
    body: [
      "- Say hello in the intro channel on Slack (for members in their first 90 days). It checks off when you post there.",
      "- Schedule your first prickle, pointing at the calendar icon in Upcoming.",
      "- Sync your calendar, pointing at the sync card on Commitments. It checks off once your calendar app has fetched your feed.",
      "- The goal form now explains the difference between a Target and a Habit, and new goals start pinned to your dashboard and shown on your profile (you can untick either).",
    ].join("\n"),
  },
  {
    slug: "gentle-reminders",
    date: "2026-10-15",
    audience: "product",
    category: "new",
    title: "Gentle reminders to say hello and to plan a prickle",
    summary:
      "Newcomers get a nudge to say hello in the intro channel, and members with nothing planned can get a reminder to put a prickle on their calendar.",
    body: [
      "- Introduction reminders go to members in their first 90 days who have not yet said hello in the intro channel.",
      "- Prickle reminders go to members with nothing on their calendar and no recent prickle. They are off until you turn them on under Settings, Notifications, and they come less often the longer they go unanswered.",
      "Both follow the channels you choose in [Notifications](/settings/notifications). They reached every member on 1 November.",
    ].join("\n\n"),
  },
  {
    slug: "start-a-new-streak-nudge",
    date: "2026-10-15",
    audience: "product",
    category: "improved",
    title: "A kinder nudge when a streak lapses",
    summary:
      "The sad broken-heart badge on upcoming prickles is now a seedling that invites you to start a new streak.",
    body: [
      "Where a prickle used to show a broken heart for a streak you had lost, it now shows a seedling and says how many weeks in a row you reached there, with a nudge to beat your best.",
    ].join("\n\n"),
  },
  {
    slug: "time-zone-choices",
    date: "2026-10-18",
    audience: "product",
    category: "improved",
    title: "Clearer time zone settings",
    summary:
      "The auto-detect option is gone, your current location is always one click away, and the time zone prompt no longer pops up after you pick a zone yourself.",
    body: [
      "- The Settings time zone list no longer has an auto-detect option that did not stick. Your Hub keeps a real time zone and still offers to switch when it sees you are somewhere else.",
      "- Your browser's current zone is always in the list, with a Use current location button to return to it.",
      "- Picking a zone in Settings no longer immediately asks whether to change it, and the dropdown updates right away when you answer Yes.",
    ].join("\n"),
  },
  {
    slug: "zoom-meeting-id",
    date: "2026-10-18",
    audience: "product",
    category: "improved",
    title: "Join details for the prickle room",
    summary:
      "The check-in window, the Slack check-in message and your calendar feed now carry the prickle room's Zoom link, meeting ID and passcode.",
    body: [
      "Instead of hunting for the link, you get a Join button with the passcode in the check-in window and in the Slack check-in message, and each prickle in your personal calendar feed has the link, meeting ID and passcode in its description. This is for the main prickle room.",
    ].join("\n\n"),
  },
  {
    slug: "courses-in-the-hub",
    date: "2026-10-19",
    audience: "product",
    category: "new",
    title: "Courses in the Hub",
    summary:
      "Watch the lessons of courses you have access to right in the Hub, mark them complete and pick up where you left off.",
    body: [
      "Find them under [Courses](/courses). You see the courses you have access to, with your progress, an outline by module and a lesson page with the video, its text and downloadable files.",
      "- A lesson completes by itself when you have watched about 90 percent, or you can press Mark complete under the video. A card then points you to the next lesson.",
      "- The Hub remembers where you stopped and resumes from there.",
      "- Course pages have a hero image, a progress sidebar and lesson thumbnails. Course names above a lesson link back to the course and to each module.",
      "- A course you pre-ordered shows its launch date and opens on that day.",
    ].join("\n"),
  },
  {
    slug: "on-air-light",
    date: "2026-10-19",
    audience: "product",
    category: "new",
    title: "On air light",
    summary:
      "A light in the header shows when the prickle room has people in it and how to join.",
    body: [
      "When people are at the table, a red On air light blinks beside the bell with a count. Click it to see the prickle and its host, who is in the room, and the Zoom link with meeting ID and passcode. When the room is empty the light is grey, and the same link is offered as a way to start a pop-up prickle.",
    ].join("\n\n"),
  },
  {
    slug: "display-name-and-identity",
    date: "2026-10-20",
    audience: "product",
    category: "new",
    title: "Choose your display name",
    summary:
      "Settings now says which name the community sees, and you can pick one of your pen names or write your own as your display name.",
    body: [
      "On [Identity](/settings/identity) the sections now run Real Name, Display Name, Pen Names, Email Aliases and Birthday. Your Real Name is for your account and records. Your Display Name is what other members see.",
      "Choose a pen name from the list or Write your own. A name already used by another member is refused. Each section is its own stop in Getting started.",
    ].join("\n\n"),
  },
  {
    slug: "connect-slack-step",
    date: "2026-10-20",
    audience: "product",
    category: "improved",
    title: "Connect Slack in Getting started",
    summary:
      "Getting started has a Connect Slack step, and connecting also keeps what you have read in sync between the Hub and Slack.",
    body: [
      "Connecting Slack (Settings, Account) lets Hub chat send as you. Once connected, reading a conversation in one place clears it as unread in the other. Connecting also makes Open Hedgie Hub in Slack find your account even if your Slack email differs from your Hub email.",
      "A tour you already finished reopens to show only the steps added since.",
    ].join("\n\n"),
  },
  {
    slug: "link-previews",
    date: "2026-10-20",
    audience: "product",
    category: "fixed",
    title: "Cleaner previews for Hub links",
    summary:
      "A Hub link shared in Slack and elsewhere now shows a single centered picture instead of an empty or cropped image.",
    body: [
      "We fixed the preview image for shared Hub links so it appears and is not cropped. Slack on iPhone also no longer shows a stray ampersand code in the preview.",
    ].join("\n\n"),
  },
  {
    slug: "course-pages-and-calendar-polish",
    date: "2026-10-20",
    audience: "product",
    category: "improved",
    title: "Course cards, module pages and a clearer today",
    summary:
      "Courses show as cards with cover images, each module has its own page, and today stands out more on calendars in light mode.",
    body: [
      "- The Courses page is a grid of cards with cover images.",
      "- Browser tab titles name the course, module and lesson.",
      "- In light mode, the today column on calendars is easier to see.",
    ].join("\n"),
  },
  {
    slug: "chat-edit-and-delete",
    date: "2026-10-21",
    audience: "product",
    category: "new",
    title: "Edit and delete your chat messages",
    summary:
      "You can edit or delete a message you wrote in Hub chat, and the change reaches Slack too.",
    body: [
      "Edit and Delete are on your own messages. An edit is saved in Slack first and then here, so the two always agree, and a deleted message leaves a short note where it was. Later changes also let you edit messages you wrote in Slack itself once you have connected Slack.",
    ].join("\n\n"),
  },
  {
    slug: "chat-files-and-emoji",
    date: "2026-10-22",
    audience: "product",
    category: "improved",
    title: "Chat: files, images and a full emoji picker",
    summary:
      "Chat now shows images and files under messages, lets you send files to Slack, and has a full emoji picker with skin tones.",
    body: [
      "- Images and GIFs show inline and open full size when clicked. Other files show as download chips with name and size.",
      "- Attach files with the paperclip, by pasting an image, or by dragging them onto the composer, the chat or a thread, with upload progress and a cancel. They reach Slack too.",
      "- Download all on a message with several files gives you one zip.",
      "- The emoji picker has search, categories, custom emoji and a skin tone choice, and works with the keyboard. Hover a reaction to see who reacted.",
    ].join("\n"),
  },
  {
    slug: "chat-days-notices-and-people",
    date: "2026-10-22",
    audience: "product",
    category: "improved",
    title: "Chat: day markers, Slack notices and adding people",
    summary:
      "Chat marks each day, shows times in your time zone, shows notices like channel renames, and lets you add people to a conversation.",
    body: [
      "- A marker between days sticks to the top while you read that day, and times follow your time zone setting.",
      "- Notices Slack posts itself, such as a channel rename or a topic change, show as quiet lines.",
      "- Copy link on a message gives a link that opens right on that message.",
      "- A conversation's members page lets you join or leave a public channel and add people. Only staff can remove someone else.",
    ].join("\n"),
  },
  {
    slug: "member-hover-card",
    date: "2026-10-22",
    audience: "product",
    category: "new",
    title: "Hover cards for members",
    summary:
      "Point at a member's name or photo in chat or on Streaks to see their profile at a glance.",
    body: [
      "The card shows their photo and name, when they became a Hedgie, up to three Ask me about topics and social links, with Message and View profile buttons. It also opens from the keyboard. On [Streaks](/streaks), sister names now link to profiles.",
    ].join("\n\n"),
  },
  {
    slug: "secondary-time-zone",
    date: "2026-10-22",
    audience: "product",
    category: "new",
    title: "Show a second time zone beside prickle times",
    summary:
      "Settings has an option to show a second time zone, such as Eastern, beside the prickle times in your own.",
    body: [
      "Turn on Also show a second time zone under [Preferences](/settings/preferences) and pick any zone. It starts at Eastern, where prickles are announced. It is off by default, and appears next to times on upcoming prickles, events and commitments.",
    ].join("\n\n"),
  },
  {
    slug: "wheel-of-wonder-message-on-slack",
    date: "2026-10-22",
    audience: "product",
    category: "improved",
    title: "Wheel of Wonder waits for you",
    summary:
      "Spinning the Wheel now only picks a match; the chat and icebreaker start when you click Message on Slack.",
    body: [
      "Before, a spin opened a Slack chat and posted the icebreaker straight away. Now you can look at your match first, and the button says what it will do.",
    ].join("\n\n"),
  },
  {
    slug: "check-in-feeling-wheel",
    date: "2026-10-24",
    audience: "product",
    category: "improved",
    title: "Check-ins with mood scales and the Feeling Wheel",
    summary:
      "Check-ins now use two labeled mood scales and an optional Feeling Wheel, and check-out asks whether you got what you came for.",
    body: [
      "- Before a prickle: rate how you feel overall and your energy on labeled five-step scales, optionally name the feeling from the Feeling Wheel (search works too), and choose your intention from a list.",
      "- After a prickle: say whether you got what you came for, then the same scales and the progress questions.",
      "The same questions appear in the check-in window, in Slack messages and where you log progress.",
    ].join("\n"),
  },
  {
    slug: "member-help-articles",
    date: "2026-10-24",
    audience: "product",
    category: "new",
    title: "Hedgie Help",
    summary:
      "Hedgie Help has articles on joining a prickle, planning your month, becoming a host, starting a pop-up prickle and running a prickle.",
    body: [
      "Open [Hedgie Help](/help) from the question mark in the top bar beside the bell. It is also in the search. Each article walks through the real screens.",
    ].join("\n\n"),
  },
  {
    slug: "zoom-name-in-getting-started",
    date: "2026-10-24",
    audience: "product",
    category: "improved",
    title: "Getting started asks for your Zoom name",
    summary:
      "The tour explains that prickles are counted by the name Zoom shows, and refuses a name another member already uses.",
    body: [
      "Change your name in Zoom to match your Real Name, or add the name you use in Zoom as a pen name. A name that is another member's pen name or real name is refused, so attendance cannot land on the wrong person.",
    ].join("\n\n"),
  },
  {
    slug: "chat-mentions-and-slack-edits",
    date: "2026-10-24",
    audience: "product",
    category: "improved",
    title: "Chat: mention people and channels, edit Slack-written messages",
    summary:
      "Type the at sign or the hash sign in chat to pick people and channels, and edit or delete messages you wrote in Slack once you have connected Slack.",
    body: [
      "- Type @ to see people in the conversation, keep typing to search every active member. Type # to pick a channel.",
      "- Edit or delete a message you wrote in Slack, if you have connected Slack.",
      "- Joins, adds and leaves show as quiet lines, and the browser tab names the conversation.",
    ].join("\n"),
  },
  {
    slug: "week-calendars-on-phones",
    date: "2026-10-24",
    audience: "product",
    category: "fixed",
    title: "Week calendars scroll on phones",
    summary:
      "On a phone you can now scroll sideways to Thursday through Saturday on week calendars instead of having them cut off.",
    body: [
      "This fixes All Prickles, My Attendance and the host request form. We also made secondary text easier to read, using darker or lighter greys that meet contrast guidelines in both light and dark mode, and made the closed mobile menu skip keyboard focus.",
    ].join("\n\n"),
  },
  {
    slug: "big-sisters-groundwork",
    date: "2026-10-15",
    audience: "engineering",
    category: "new",
    title: "Big Sisters program, behind a preview flag",
    summary:
      "Matching, volunteers, introductions and a Big Sisters page were built behind a preview flag that is not on for everyone.",
    body: [
      "New members would get a big sister for their first 30 days, with staff choosing the match and arrival dates and trial outcomes derived from membership data. Not yet a general product update; add a product entry when the flag goes on. See docs/BIG_SISTERS.md.",
    ].join("\n\n"),
  },
  {
    slug: "coverage-reporting",
    date: "2026-10-14",
    audience: "engineering",
    category: "new",
    title: "Test coverage reporting",
    summary:
      "Coverage is measured, API tests run in-process so route coverage counts, and new code must meet a floor.",
    body: [
      "v8 coverage with area floors; API tests call route handlers in-process; a required Coverage report check gates patches.",
    ].join("\n\n"),
  },
  {
    slug: "usage-analytics-tracking-plan",
    date: "2026-10-20",
    audience: "engineering",
    category: "new",
    title: "Usage analytics with a tracking plan",
    summary:
      "Only declared events are stored, with funnels and a usage explorer for admins.",
    body: [
      "Events are declared in lib/analytics/events.ts and funnels in lib/analytics/funnels.ts. Members can leave usage statistics from /privacy. See docs/ANALYTICS.md.",
    ].join("\n\n"),
  },
  {
    slug: "ci-and-tooling-week-1018",
    date: "2026-10-21",
    audience: "engineering",
    category: "improved",
    title: "pnpm, auto-merge, docs-only skips and container queries",
    summary:
      "The repo moved to pnpm, new PRs auto-merge on green, docs-only changes skip tests and deploy, and layouts use named container queries.",
    body: [
      "Named container sizes live in tailwind.config.ts. A production tag marks what is deployed. Migration order is checked in pre-commit and CI.",
    ].join("\n\n"),
  },
  {
    slug: "short-ids-phase-one",
    date: "2026-10-23",
    audience: "engineering",
    category: "improved",
    title: "Short prefixed ids for Tier 1 tables",
    summary:
      "Members, prickles and other visible records moved from uuids to readable prefixed ids.",
    body: [
      "new_id(prefix) generates ids like mbr_ and prkl_, and new tables follow the same rule. Links to members and prickles use the new ids. See docs/SHORT_IDS_PLAN.md.",
    ].join("\n\n"),
  },
  {
    slug: "demo-harness",
    date: "2026-10-23",
    audience: "engineering",
    category: "new",
    title: "Demo harness and help screenshots",
    summary:
      "A separate demo stack with Playwright scenes produces the screenshots used in Hedgie Help.",
    body: [
      "Every scene also runs page checks (accessibility, overflow, console), and screenshots are published before deploy. See docs/DEMO_AND_HELP.md.",
    ].join("\n\n"),
  },
  {
    slug: "data-access-layer",
    date: "2026-10-23",
    audience: "engineering",
    category: "new",
    title: "Data access layer with repositories",
    summary:
      "Tables are queried through repositories with an in-memory twin for tests, starting with attendance.",
    body: [
      "lib/data holds an interface, a Supabase class and an in-memory class per aggregate, and tests/lib/data-access-layer.test.ts guards against new direct queries.",
    ].join("\n\n"),
  },
  {
    slug: "typed-supabase-clients",
    date: "2026-10-24",
    audience: "engineering",
    category: "improved",
    title: "Typed Supabase clients and stale-type check",
    summary:
      "Every Supabase client is typed with the generated Database, and CI fails when the generated types are stale.",
    body: [
      "pnpm types:gen regenerates lib/data/database.types.ts and pnpm types:check runs in CI.",
    ].join("\n\n"),
  },
{
    slug: "navigation-reorganized",
    date: "2026-10-25",
    audience: "product",
    category: "improved",
    title: "Clearer navigation and a footer",
    summary:
      "The sidebar now separates Community, where you take part, from Explore, where you browse, and the My prefix is gone from your own pages.",
    body: [
      "Chat, Wheel of Wonder and Big Sisters stay under Community. Members, Book Shelf and Events moved to a new Explore group. My Writing and My Prickles are now Writing and Prickles in the sidebar and search (their page headings are unchanged).",
      "The member area also has a small footer with links to Privacy and Contact us.",
    ].join("\n\n"),
  },
  {
    slug: "chat-posts-as-you",
    date: "2026-10-25",
    audience: "product",
    category: "improved",
    title: "Chat posts as you, not as a bot",
    summary:
      "Messages and files you post in chat now go out under your own connected Slack account.",
    body: [
      "If your Slack account is not connected, or its connection has stopped working, chat asks you to connect it again in Settings before you can post.",
    ].join("\n\n"),
  },
  {
    slug: "events-page",
    date: "2026-10-28",
    audience: "product",
    category: "new",
    title: "A better Events page",
    summary:
      "Events leads with what is coming up, with a picture on each card and a month-at-a-glance list that shows the time of day.",
    body: [
      "At [/events](/events), upcoming special events and educational sessions sit on top as picture cards. Below them, pick this month, next month or the one after to see everything by day, with times shown in your own time zone. Titles are tidied up.",
      "Past events have their own page at [/events/past](/events/past), a month at a time.",
    ].join("\n\n"),
  },
  {
    slug: "search-and-display-names",
    date: "2026-10-27",
    audience: "product",
    category: "improved",
    title: "Search finds nicknames and guest speakers",
    summary:
      "Member search now matches the other names a member goes by, prickle search matches guest speakers, and hosts and attendees show the name people go by.",
    body: [
      "When a result matches a nickname, a small line under it says so. Hosts and attendees on prickle pages, the attendance calendar, calendar feed titles and the Events page now show each person's display name instead of their legal name.",
      "Members can no longer turn their own alternate names on or off in Settings. Those names are how attendance gets matched to you, so switching one off could lose matches. Staff can still do it for you.",
    ].join("\n\n"),
  },
  {
    slug: "help-menu",
    date: "2026-10-27",
    audience: "product",
    category: "improved",
    title: "A help menu in the top bar",
    summary:
      "The help icon is now a menu with Hedgie Help and Send feedback.",
    body: [
      "Hedgie Help is at [/help](/help). Send feedback opens the feedback form in a panel, replacing the floating button.",
    ].join("\n\n"),
  },
  {
    slug: "dashboard-continue-watching",
    date: "2026-10-27",
    audience: "product",
    category: "new",
    title: "Continue watching on your dashboard",
    summary:
      "If you are partway through a course lesson, your dashboard shows a card that takes you straight back to it.",
    body: [
      "The card shows the lesson, the course, a progress bar and a link to the lesson. It appears only when you have a lesson in progress or a started course with a next lesson waiting.",
    ].join("\n\n"),
  },
  {
    slug: "media-library-and-book-covers",
    date: "2026-10-29",
    audience: "product",
    category: "new",
    title: "Book covers at any size, from your own images",
    summary:
      "Upload a book cover at any size, pick it again from your own images and adjust its crop. We make the Amazon-size version for you.",
    body: [
      "The book form has one Choose cover button with a tab of your own images and an upload tab. JPEG, PNG, WebP, GIF, AVIF and iPhone HEIC photos all work, up to 4 MB. The exact-size rule is gone.",
      "Under the cover you will see a download link for the size Amazon wants, or what is missing if the image is too small. Older covers keep working but have no Amazon version until you upload them again.",
    ].join("\n\n"),
  },
  {
    slug: "book-genres-as-tags",
    date: "2026-10-31",
    audience: "product",
    category: "improved",
    title: "Book genres as tags you can filter by",
    summary:
      "Genres on the book form are tags, the Book Shelf can be filtered by genre, and search finds books by genre.",
    body: [
      "Add up to five genres or tropes per book. On the [Book Shelf](/bookshelf), genre chips with counts narrow the list, and clicking one again clears it.",
    ].join("\n\n"),
  },
  {
    slug: "public-lesson-previews",
    date: "2026-10-30",
    audience: "product",
    category: "improved",
    title: "Shared lesson links show a preview",
    summary:
      "A course lesson link shared with someone who is signed out shows its title, a short teaser and a thumbnail, with a way to sign in.",
    body: [
      "This is what you see when a lesson link unfurls in Slack or a message. The video and the full text stay behind sign-in.",
    ].join("\n\n"),
  },
  {
    slug: "sidebar-modes",
    date: "2026-10-30",
    audience: "product",
    category: "new",
    title: "Choose how the sidebar behaves",
    summary:
      "A button in the header cycles the sidebar between pinned open, auto-hide as an icon rail, and closed, and remembers your choice.",
    body: [
      "In auto-hide the sidebar rests as a slim icon rail and opens over the page when you hover or focus it, so the page does not shift. Until you choose, the sidebar auto-hides on chat and stays open elsewhere.",
    ].join("\n\n"),
  },
  {
    slug: "descriptions-keep-formatting",
    date: "2026-10-30",
    audience: "product",
    category: "fixed",
    title: "Prickle and event descriptions keep their formatting",
    summary:
      "Descriptions imported from the calendar now keep bold, italic, links, bullet lists, paragraph breaks and dividing lines instead of running together.",
    body: [
      "Prickles that were already imported pick up the formatting the next time the calendar refreshes.",
    ].join("\n\n"),
  },
  {
    slug: "privacy-page",
    date: "2026-10-30",
    audience: "product",
    category: "improved",
    title: "A clearer privacy page, and a switch for usage statistics",
    summary:
      "The privacy page opens with a short summary, answers questions in groups, and can be read without signing in. A switch lets you stop sharing usage statistics.",
    body: [
      "[/privacy](/privacy) now covers what we collect, who can see it, chat and messages, how long we keep things, your choices and the services we use.",
      "Turn off Share usage statistics and the Hub stops recording your usage and removes the usage events already stored under your account. Error recordings, used to fix crashes, continue.",
    ].join("\n\n"),
  },
  {
    slug: "projects-past-and-delete",
    date: "2026-10-31",
    audience: "product",
    category: "improved",
    title: "Past projects, deleting, and goals that ended",
    summary:
      "Finished projects are listed apart from the ones you are working on, you can delete a project from its details, and goals that ended unmet no longer show as a standing score.",
    body: [
      "On My Writing, projects that are complete, published or abandoned move to a collapsed Past projects section. They still open as usual, and changing a status moves them back.",
      "Delete is in the project's Edit details. Its goals and entries go with it, and a book published from it stays on the shelf. Deleted items are kept until you ask us to remove them, as [/privacy](/privacy) explains.",
      "A goal whose end date passed before its target now moves to Past goals on the project page and leaves the project list, the dashboard and your profile.",
    ].join("\n\n"),
  },
  {
    slug: "fixes-2026-10-31",
    date: "2026-10-31",
    audience: "product",
    category: "fixed",
    title: "Small fixes and polish",
    summary:
      "Cleaner event names, a past-events page that works, and tabs left open across an update reload themselves.",
    body: [
      "- Event names drop the calendar's label and category and keep who the event is with.",
      "- The past events page no longer crashes.",
      "- A tab left open while the Hub updates now reloads instead of failing on its next action.",
    ].join("\n"),
  },
  {
    slug: "course-builder",
    date: "2026-10-31",
    audience: "engineering",
    category: "new",
    title: "Course editor for Hub-owned courses, first parts",
    summary:
      "Staff can create and edit a course in the Hub, add, rename, duplicate, delete and reorder modules and lessons, and play a lesson's video in the builder.",
    body: [
      "This is staff-only and not visible to members yet. Reorders write a single audit entry with the order before and after. Courses are read and written through CourseRepository and CourseProgressRepository.",
    ].join("\n\n"),
  },
  {
    slug: "google-calendar-live-sync",
    date: "2026-10-28",
    audience: "engineering",
    category: "improved",
    title: "Google Calendar syncs from push notifications",
    summary:
      "The calendar sync opens and renews its push channel on its own and syncs only what changed.",
    body: [
      "Deletions outside the watched window are caught, and the admin calendar refreshes itself when the sync changes prickles. See CalendarSyncStateRepository in lib/data/calendar-sync-state.ts.",
    ].join("\n\n"),
  },
  {
    slug: "data-layer-rollout",
    date: "2026-10-31",
    audience: "engineering",
    category: "improved",
    title: "More tables behind repositories, and migration safety",
    summary:
      "Courses, billing, events, books, Zoom, Slack and the people and profile tables moved behind repositories, and a check now fails migrations that drop or rename what live code still uses.",
    body: [
      "The guard test parses the source and fails on a new direct query. Squawk runs in the Check migrations job, so removals ship in two pull requests: stop using it, then drop it.",
    ].join("\n\n"),
  },
  {
    slug: "alerts-and-monitoring",
    date: "2026-10-30",
    audience: "engineering",
    category: "improved",
    title: "Alerts for crashes, failing page sections and monitors",
    summary:
      "The team is alerted when a page crashes in the browser, a page section fails or times out, or a synthetic monitor fails.",
    body: [
      "Section failure alerts link to the error search. Video playback has a nightly end-to-end check and its configuration lives in code, and the error-tracking organization settings are now code too.",
    ].join("\n\n"),
  },
  {
    slug: "privacy-retention",
    date: "2026-10-30",
    audience: "engineering",
    category: "improved",
    title: "Privacy retention job and usage rollups",
    summary:
      "A nightly job removes exact IP addresses and browser strings after 90 days, and usage events are rolled up into totals before older ones are removed after 13 months.",
    body: [
      "The device type is parsed once when a visit is recorded and kept, along with the approximate place. Usage rollups are built from now; nothing reaches 13 months until late 2027. Session Replay for ordinary visits follows consent and the usage-statistics switch, while error-only recording stays on. This backs the promises on [/privacy](/privacy).",
    ].join("\n\n"),
  },
  {
    slug: "chat-open-to-everyone",
    date: "2026-11-01",
    audience: "product",
    category: "new",
    title: "Hub chat is open to every member",
    summary:
      "Read our Slack channels in the Hub, post and react from there, and optionally connect your Slack account so your messages go out as you.",
    body: [
      "Chat is in the sidebar under Community. You see the conversations you are in and the public channels, with threads and reactions, and you can post and reply from the Hub.",
      "To have your messages appear in Slack under your own name, connect your Slack account under Settings, Account.",
    ].join("\n\n"),
  },
  {
    slug: "events-open-to-everyone",
    date: "2026-11-01",
    audience: "product",
    category: "new",
    title: "Events is open to every member",
    summary:
      "See what is coming up, with a picture on each event and a month-at-a-glance list that shows the time of day.",
    body: ["Find it under Events in the sidebar, with past events at /events/past."].join("\n\n"),
  },
  {
    slug: "reminders-for-everyone",
    date: "2026-11-01",
    audience: "product",
    category: "new",
    title: "Gentle reminders are on for every member",
    summary:
      "Newcomers get a nudge to say hello in the intro channel, and members with nothing planned can get a reminder to put a prickle on their calendar.",
    body: [
      "Choose which channels they come on, or turn them off, under [Notifications](/settings/notifications). Prickle reminders are off until you turn them on, except in your first 90 days.",
    ].join("\n\n"),
  },
  {
    slug: "courses-open-to-everyone",
    date: "2026-11-02",
    audience: "product",
    category: "new",
    title: "Courses are open to every member",
    summary:
      "Watch the lessons of courses you have access to right in the Hub, mark them complete and pick up where you left off.",
    body: ["Find them under [Courses](/courses). You see the courses you have access to, with your progress."].join("\n\n"),
  },
  {
    slug: "sign-in-with-an-emailed-code",
    date: "2026-11-02",
    audience: "product",
    category: "new",
    title: "Sign in with a code from your email",
    summary:
      "The sign-in email now carries a one-time code that works from any device.",
    body: [
      "Go to [/login](/login), enter your email and the code from the sign-in email. The code also works if the link opens in a different browser than the one you asked from, such as a phone's mail app.",
      "If you ask for a link twice within a minute, the page now tells you one was just sent and to check your inbox.",
    ].join("\n\n"),
  },
  {
    slug: "chat-rich-text",
    date: "2026-11-02",
    audience: "product",
    category: "improved",
    title: "The chat box writes like Slack",
    summary:
      "The chat box shows your formatting as you write it, with bold, italic, underline, strikethrough, code, quotes, links and nested or numbered lists.",
    body: [
      "There is a formatting toolbar and the usual shortcuts. Type :name to pick an emoji from a list. Formatting reaches Slack as real formatting, including lists and underline.",
      "Unsent text is saved as a draft for each conversation and thread, and a Drafts section in the sidebar takes you back to it. Editing a message lets you add or remove files, and saving an emptied edit asks whether to delete the message. Hover an @mention of a member to see their card. Copy message copies readable text and keeps formatting when you paste it into the chat box.",
    ].join("\n\n"),
  },
  {
    slug: "chat-sidebar-conversations-first",
    date: "2026-11-02",
    audience: "product",
    category: "improved",
    title: "Your conversations come first in the chat sidebar",
    summary:
      "The chat sidebar lists the conversations you are in, with a Browse channels button for the public channels you could join.",
    body: [
      "Private channels show a lock instead of a #, like Slack.",
    ].join("\n\n"),
  },
  {
    slug: "allow-animations",
    date: "2026-11-02",
    audience: "product",
    category: "new",
    title: "An Allow animations setting",
    summary:
      "Choose System, Allow or Reduce for animations in Settings. With animations reduced, moving images and emoji show a still.",
    body: [
      "Find it in [Settings](/settings), under Preferences. System follows your device. With animations reduced, interface motion stops, animated emoji show a still, and GIF attachments in chat play and pause when you click them. The choice is saved on this device, like the theme.",
    ].join("\n\n"),
  },
  {
    slug: "check-in-and-check-out",
    date: "2026-11-02",
    audience: "product",
    category: "improved",
    title: "Check-in and check-out are easier to reach",
    summary:
      "You can check in at any point while a prickle is running, and a running prickle on your upcoming list offers Check out beside Check in.",
    body: [
      "Check-in now stays open until the prickle ends, and it is offered if you are in the prickle's Zoom room even without a commitment or a calendar item. The check-out message comes 5 to 10 minutes before a prickle ends, so you can check out before you leave for your next thing.",
      "You no longer need a writing goal to be asked to check in or check out. Without a goal you get the usual questions, plus a short tip about setting one.",
    ].join("\n\n"),
  },
  {
    slug: "course-pages-previews-and-lists",
    date: "2026-11-02",
    audience: "product",
    category: "improved",
    title: "Course links preview, and course pages fit phones",
    summary:
      "A course link shared with someone who is signed out shows a preview, and the lesson and module pages show one back link on narrow screens.",
    body: [
      "A course link unfurls with the course title, a short teaser and its cover. If you have no courses yet, the Courses page points you to The Ready Writer's waitlist.",
    ].join("\n\n"),
  },
  {
    slug: "calendar-feed-one-day-events",
    date: "2026-11-02",
    audience: "product",
    category: "fixed",
    title: "Your calendar feed shows events at their time",
    summary:
      "One-day events you added to your subscribed calendar now appear at their start and end time instead of as all-day entries.",
    body: [
      "Multi-day events, such as retreats, stay all-day. The search button in the header is also a steady square on phones instead of a clipped sliver.",
    ].join("\n\n"),
  },
  {
    slug: "my-books-multiple-formats",
    date: "2026-11-03",
    audience: "product",
    category: "improved",
    title: "One book, print and ebook",
    summary:
      "A book on your shelf can have a print edition and an ebook edition, each with its own link and price, on one card.",
    body: [
      "In the book form, switch on Print, Ebook or both. The shelf, your profile and the project card show one link per edition, such as Print $17.99 and Ebook $4.99, with genres on their own line below. Existing books keep their single edition.",
    ].join("\n\n"),
  },
  {
    slug: "fixes-2026-11-03",
    date: "2026-11-03",
    audience: "product",
    category: "fixed",
    title: "Small fixes and polish",
    summary:
      "Fixes to chat, course videos, Slack check-in messages and the sign-in page.",
    body: [
      "- Chat: Enter sends a message from inside a list or code block (Shift+Enter starts the next line), and several attached pictures wrap instead of running off the pane.",
      "- Course videos say what failed and retry once if the playback link expired while the page sat open.",
      "- The Slack check-in and check-out messages have a Submit button that closes them.",
      "- The sign-in page has one Sign-in code box for an email code or a Slack code or link.",
    ].join("\n"),
  },
  {
    slug: "hub-chat-direct-messages",
    date: "2026-11-02",
    audience: "engineering",
    category: "new",
    title: "Direct messages between members, behind a feature flag",
    summary:
      "Members can start a Hub-only direct message from a profile's Message button, switched off for everyone until it is rolled out.",
    body: [
      "These conversations stay in the Hub and nothing goes to Slack. They are private and restricted, so staff can see that one exists but not its text. The chat_dms feature decides who can start one. It becomes a product entry when it is on for everyone.",
    ].join("\n\n"),
  },
  {
    slug: "slack-dm-bridge",
    date: "2026-11-03",
    audience: "engineering",
    category: "new",
    title: "Slack DM bridge, switched off",
    summary:
      "One-on-one Slack DMs can be pulled into chat for the members a feature flag covers, read with each member's own Slack token.",
    body: [
      "It has live delivery of new messages, a nightly pull, and a way to start a Slack DM from a profile's Message button. The feature is off for everyone as of this entry. /privacy describes what is read and kept, and the choice is to disconnect Slack. It becomes a product entry when it is on for everyone.",
    ].join("\n\n"),
  },
  {
    slug: "ci-speed-and-repos",
    date: "2026-11-01",
    audience: "engineering",
    category: "improved",
    title: "Faster CI and repository-based tests",
    summary:
      "Lint and type checks overlap with tests, and many tests use the in-memory repositories instead of faked database calls.",
    body: [
      "The notifier, channels, reminders and check-in messages now take repositories instead of database clients, and 176 PostgREST casts were removed by typing the boundary once. pnpm seed:local loads a typed seed profile into the local database.",
    ].join("\n\n"),
  },
  {
    slug: "launch-tooling",
    date: "2026-11-02",
    audience: "engineering",
    category: "new",
    title: "Launch tooling",
    summary:
      "Sign-in accounts were created in advance for members, then released and emailed in batches, each with its own sign-in code.",
    body: [
      "pnpm auth:precreate and pnpm launch:email did the rollout. Both default to a dry run and take --limit and --only to trial it first, and the email can be re-run safely because each sent member is marked.",
    ].join("\n\n"),
  },
  {
    slug: "removal-requests-and-community-manager",
    date: "2026-11-03",
    audience: "engineering",
    category: "new",
    title: "Member data removal routine and a Community Manager role",
    summary:
      "A routine removes a member's data on request, and a read-only Community Manager role opens a fixed set of admin pages.",
    body: [
      "The removal routine has a staff entry point and a decision for every table that holds member data. Admins can preview the admin area as a Community Manager, and new admin pages stay closed to that role until they are added on purpose.",
    ].join("\n\n"),
  },
  {
    slug: "whats-new-changelog",
    date: "2026-11-04",
    audience: "product",
    category: "new",
    title: "A changelog for the Hedgie Hub",
    summary:
      "See what's new and fixed in the Hub, right here in the Hub. Choose how you hear about updates in Settings → Notifications.",
    body: [
      "Every improvement and fix you might notice now gets a short write-up here, newest first, with screenshots where they help.",
      "![The What's new page in the Hub](/changelog/whats-new-changelog/01-whats-new-list.webp)",
      "You can find it any time under the **?** menu in the top bar.",
    ].join("\n\n"),
    image: { src: "/changelog/whats-new-changelog/01-whats-new-list.webp", alt: "The What's new page in the Hub, listing the latest update" },
  },
];
