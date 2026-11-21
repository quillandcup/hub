import { SUPPORT_EMAIL } from "@/lib/config";
import { RETENTION } from "@/lib/retention";
import { plainText, type Rich } from "@/lib/trust-text";

/**
 * What the Privacy page (`/privacy`) says, as data: the one place the member-facing sentences are written. The page
 * renders it, and the staff page (`/admin/privacy`, via `src/lib/privacy-promises.ts`) shows the same sentences as "Members
 * read", so a sentence exists once. Change the wording together with the code, and bump `PRIVACY_EFFECTIVE`
 * in `src/app/privacy/page.tsx`.
 *
 * Two rules for what goes in here:
 * - No provider is named. Providers are described by what they do ("our payment provider"); the names live on the staff
 *   page and in evidence paths (`tests/lib/trust-no-provider-names.test.ts` guards this).
 * - Numbers come from `src/lib/retention.ts`, the same constants the nightly job enforces.
 *
 * An item with an `id` can be the text behind a promise: a promise row in `src/lib/privacy-promises.ts` names the ids it
 * reads. What is true of the code today is written in the comment above `PrivacyPage` in `src/app/privacy/page.tsx`.
 */

/** An item whose id a promise row can read. */
interface Unit {
  id?: string;
  text: Rich;
}

export type PrivacyBlock =
  | { kind: "p"; id?: string; text: Rich; small?: boolean }
  | { kind: "subheading"; text: string; /** An anchor other pages link to. */ id?: string }
  | { kind: "table"; columns: readonly string[]; emphasizeFirst?: boolean; rows: readonly { id?: string; cells: readonly Rich[] }[] }
  | { kind: "details"; title: string; paragraphs: readonly Unit[] }
  | { kind: "list"; small?: boolean; items: readonly Unit[] }
  /** The interactive "Share usage statistics" switch; `signedOut` is what a visitor without an account reads instead. */
  | { kind: "switch"; signedOut: Rich };

export interface PrivacySection {
  id: string;
  title: string;
  blocks: readonly PrivacyBlock[];
}

const mail = { link: `mailto:${SUPPORT_EMAIL}`, text: SUPPORT_EMAIL } as const;
const seeBelow = { link: "#choices", text: "see below" } as const;

export const PRIVACY_TITLE = "Privacy";
export const PRIVACY_TAGLINE = "What the Hub collects about you, who can see it, how long we keep it and what you can do about it.";

export const PRIVACY_SUMMARY_TITLE = "The short version";

export const PRIVACY_SUMMARY: readonly Unit[] = [
  {
    text: "We keep what you do in the Hub, how you use it (the pages and buttons, never what you type), where you connect from, and your activity in chat.",
  },
  {
    text: "Staff can see who talks with whom, where and when, and what is said in the channels that reach the Hub. Restricted channels, group DMs and your one-on-one DMs (direct messages) are open to them only through rare, recorded emergency access, with one exception: the messages sent during a Hedgie Care plan, below.",
  },
  {
    text: "The Hub brings your one-on-one Slack DMs into Hub Chat and keeps them. See “Your Slack direct messages” below.",
  },
  {
    text: `Your exact IP address and browser details are removed after ${RETENTION.rawNetworkDays} days, and usage statistics after ${RETENTION.usageMonths} months. What you do in the Hub is kept while you are a member, and after you cancel your membership until you ask us to close your account and remove it.`,
  },
  { id: "summary-switch", text: "You can leave usage statistics off with a switch below." },
  { id: "summary-ask", text: "You can ask us to show you, correct or remove what we hold." },
];

export const PRIVACY_SECTIONS: readonly PrivacySection[] = [
  {
    id: "collect",
    title: "What we collect",
    blocks: [
      {
        kind: "table",
        columns: ["What", "What it is", "Why"],
        emphasizeFirst: true,
        rows: [
          {
            cells: [
              "The emails we send you",
              "When each email was sent, whether it arrived or bounced, and whether it was opened or a link in it clicked. Our email provider reports this to us. The email itself stays with the provider.",
              "So staff can see what you have received when you write to us, and fix delivery problems.",
            ],
          },
          {
            cells: [
              "Your account and what you do in it",
              "Your profile, projects, goals, check-ins, commitments, sign-ins, and the notifications we sent you.",
              "To run the Hub, and so your seat is kept warm through different seasons of life.",
            ],
          },
          {
            cells: [
              "Membership, billing and sessions",
              "Your plan and membership dates from our payment and course providers, and which live sessions (such as Zoom prickles) you joined and for how long. We do not store your card or bank details; our payment provider handles those.",
              "To know who is a member, and to count and recognize your time writing together.",
            ],
          },
          {
            cells: [
              "How you use the Hub",
              "Which pages you open, which buttons and links you use, what kind of search you ran and how many results (never the words), whether the things you try work, and your device, browser and screen.",
              ["To fix what is confusing and build what helps. Your choice: ", seeBelow, "."],
            ],
          },
          {
            cells: [
              "Where you connect from",
              "The IP address your connection comes from, the city, region and country it appears to be in, the page you opened, your browser, and whether Google Analytics was running in it.",
              "To know where our community writes from, and which device and place you came from.",
            ],
          },
          {
            cells: [
              "Errors and performance",
              "When something breaks, the error and a short recording of what was on screen around it, with text and form fields masked. Also how fast pages load.",
              ["To find and fix bugs. This is not part of usage statistics: ", seeBelow, "."],
            ],
          },
          {
            cells: [
              "Course videos",
              "Where you stopped, which parts you watched, how fast, whether captions were on, whether the tab was in view, and your device and browser. For a video shared in a chat message, also which message you watched it in. This is part of how courses work, so turning usage statistics off does not change it.",
              "To pick up where you left off, to mark a lesson complete once you have watched it, and to learn which lessons work.",
            ],
          },
          {
            id: "collect-video-quality",
            cells: [
              "How well course videos play",
              "Only if usage statistics are on: how long a video took to start, buffering, errors and how long it played, with your IP address, browser and device, sent to our video provider's quality measurement. It carries no name, email or account id and sets no cookie.",
              "To find and fix videos that stall or fail.",
            ],
          },
          {
            cells: [
              "Notifications",
              "A record of each notification we send you, and whether you have read it in the Hub. Turning usage statistics off does not change that. If usage statistics are on, also which notification a visit came from.",
              "To send you what you ask for, and so the bell and banners stay right.",
            ],
          },
          {
            cells: [
              "Chat",
              [
                "What you write, and the activity around it: who you talked with, where, when, how often, which channels you are in, and your reactions. Chat is covered in ",
                { link: "#chat", text: "its own section" },
                " below.",
              ],
              "To run chat, and to understand how the community connects.",
            ],
          },
        ],
      },
      { kind: "p", small: true, text: "Location from your IP address is approximate (a VPN or a mobile carrier can make it wrong)." },
    ],
  },
  {
    id: "who-sees",
    title: "Who can see it",
    blocks: [
      {
        kind: "table",
        columns: ["Who", "What they can see"],
        rows: [
          { cells: ["You", "What you add yourself and your own activity, in the Hub's screens, and anything else we hold about you if you ask us."] },
          {
            cells: [
              "Other members",
              "Your profile as you set it (including the projects and goals you choose to show), the books and awards you add, and what you post in the channels they are in. Not your usage statistics, your IP address or your private notes.",
            ],
          },
          {
            cells: [
              "Quill & Cup staff",
              "Your account and activity, your course viewing and where you connect from (by name), and usage statistics, mostly as totals, though the individual records are tied to your account while they are kept. Chat is covered in its own section below.",
            ],
          },
          {
            cells: [
              "Our product and engineering team",
              "Errors and the recordings of what was on screen around them, in our monitoring tool. Other staff cannot see them.",
            ],
          },
          { cells: ["The services that run the Hub", "Only what they need to do their job. They are listed at the bottom."] },
        ],
      },
    ],
  },
  {
    id: "chat",
    title: "Chat and messages",
    blocks: [
      {
        kind: "p",
        text: [
          "We treat two kinds of information differently. ",
          { strong: "Content" },
          " is what you wrote: message text, formatting, and files. ",
          { strong: "Activity" },
          " is everything around it: who you talked with, where, when, how often, which channels you're in, and which emoji reactions you added.",
        ],
      },
      {
        kind: "p",
        text: "Activity helps us understand how the community connects, so we can make introductions, spot hedgies who might be feeling isolated, and see what's working. It also counts toward your engagement, meaning how much you take part, including messages in private channels and direct messages.",
      },
      { kind: "subheading", text: "What staff can see" },
      {
        kind: "table",
        columns: ["Where", "Activity", "Content"],
        rows: [
          { id: "chat-public", cells: ["Public channels", "Yes", "Yes, same as every member"] },
          { id: "chat-private", cells: ["Private channels that include Billie Bot", "Yes", "Yes, unless the channel is marked restricted"] },
          { id: "chat-restricted", cells: ["Restricted private channels", "Yes", "No, except emergency access (below)"] },
          { id: "chat-group", cells: ["Group DMs that include Billie Bot", "Yes", "No, except emergency access (below)"] },
          { id: "chat-dm", cells: ["One-on-one Slack DMs, and group DMs without Billie Bot, as they reach the Hub (apart from the messages in a Hedgie Care plan, next row)", "Yes", "No, except emergency access (below)"] },
          { id: "chat-care-plan", cells: ["One-on-one Slack DMs tracked in a Hedgie Care plan: the messages sent during the plan", "Yes", "Yes, admins and community managers can read them in Hedgie Care (see “Messages in a Hedgie Care plan”, below)"] },
          { id: "chat-planned", cells: ["Private channels without Billie Bot", "Not yet. Planned: yes", "Not yet. Planned: restricted, so emergency access only"] },
        ],
      },
      {
        kind: "p",
        id: "chat-metadata",
        text: "In every conversation that reaches the Hub, restricted channels and group DMs included, staff can see who is in it, who wrote and reacted and when, and when you last read it (the Hub keeps that in step with Slack). Files shared in a conversation follow the same rule as its text. We keep a copy of files shared in the channels and group DMs the Hub mirrors, and the copy is removed if the file is deleted.",
      },
      { kind: "subheading", id: "care-plan-messages", text: "Messages in a Hedgie Care plan" },
      {
        kind: "p",
        id: "care-plan-what",
        text: "Hedgie Care is how our community manager and admins keep in touch with members: to say hello, check in on your writing or welcome you back. Each time is recorded as a care plan, with a start and an end.",
      },
      {
        kind: "p",
        id: "care-plan-who",
        text: "When a care plan starts, the staff member's one-on-one Slack DM with you is tracked automatically, when the Hub has it: there is nothing to choose or switch off. Admins and community managers can then read, in Hedgie Care, the messages sent in that DM from the start of each of your plans to its end, or until now while a plan is open. A plan can be handed over to another staff member, or taken over by an admin, and whoever holds it then sees the messages of your earlier plans, and their own DM with you is tracked too. They read the full messages, as they were sent; deleted messages are not shown.",
      },
      {
        kind: "p",
        id: "care-plan-limits",
        text: "Messages sent outside a plan are not shown there, and other direct messages with staff are treated like direct messages between members, so staff can read them only through emergency access (below). Each time someone opens these messages, we record who looked and whose plan it was, but not the messages, and Hub Chat shows a short note at the top of such a conversation. Slack's own app shows no note, so keep this in mind when you message the team there. Only admins and community managers can read them: other team members cannot.",
      },
      {
        kind: "details",
        title: "Emergency access",
        paragraphs: [
          {
            id: "chat-break-glass",
            text: "In rare cases, such as a safety or conduct report, an admin may need to read the content of a specific restricted channel or group DM. We will do that only for that one conversation and only for as long as it takes, and we will record who looked, why and when. You won't receive an automatic notification when this happens.",
          },
        ],
      },
      {
        kind: "details",
        title: "Connecting your Slack account",
        paragraphs: [
          {
            id: "chat-connection",
            text: "Hub Chat needs your Slack account connected. That lets the Hub act as you in Slack: post your messages and reactions, edit and delete the ones you wrote, join and leave channels, add people to a channel, and mark conversations read. Slack also lists permission to read and send your direct messages, and to read the private channels you are in. The Hub uses the first only for the DM bridge below. The second it doesn't use yet: we plan to bring private channels Billie Bot isn't in into Hub Chat too, restricted like the rest, and it is asked for now so you only reconnect once. Apart from that the Hub does nothing in Slack you didn't ask for. The connection is kept encrypted and used only by the Hub's server. You can disconnect it in Settings at any time (chat then stays closed until you reconnect), and Slack shows it under your authorized apps.",
          },
        ],
      },
      {
        kind: "details",
        title: "Your Slack direct messages",
        paragraphs: [
          {
            id: "dm-what",
            text: "Slack's bot can't be in a one-on-one DM, or in a group message it wasn't added to, so the Hub brings yours into chat with your own Slack connection. The Hub keeps them, shows them in your chat so you can read and reply there (your replies go to Slack as you), and counts them as activity, like any message. Slack only shows about 90 days of history on our plan; the Hub keeps its copy until you ask us to remove it.",
          },
          {
            id: "dm-who",
            text: [
              { strong: "Who can see them." },
              " You, and the other person if they are a Hub member (they see the same conversation in their own chat once their own DMs are brought in). If they aren't a member, their messages are kept in your conversation under their Slack name, and we keep nothing else about them. Staff can see that the conversation exists, who is in it, who wrote and when, but they can read the text only through emergency access, as for a restricted channel, except for the messages sent during a Hedgie Care plan (see “Messages in a Hedgie Care plan” above). Viewing the Hub as you never shows them.",
            ],
          },
          {
            id: "dm-stop",
            text: [
              { strong: "Stopping it." },
              " There is no separate switch for DMs. Disconnecting Slack in Settings stops the Hub reading your DMs, and closes Hub Chat for you until you reconnect. What the Hub has already kept stays until you ask us to close your account and remove it.",
            ],
          },
        ],
      },
      {
        kind: "details",
        title: "Viewing the Hub as you",
        paragraphs: [
          {
            id: "chat-view-as",
            text: "To help with support, an admin can view the Hub as a member. The chat is read-only and shows what you can see, except restricted channels, group DMs and direct messages.",
          },
        ],
      },
      {
        kind: "details",
        title: "Deleted messages and reactions",
        paragraphs: [
          {
            id: "chat-deleted",
            text: "When you delete a message or remove a reaction, it disappears for everyone, but we keep a record rather than erasing it. Deleted messages and removed reactions no longer count toward your activity. Staff can't read a deleted message's text or files in the Hub; the only way to read one is emergency access, the same as for a restricted conversation.",
          },
        ],
      },
    ],
  },
  {
    id: "keep",
    title: "How long we keep things",
    blocks: [
      {
        kind: "table",
        columns: ["What", "How long"],
        rows: [
          {
            cells: [
              "What you do in the Hub: your projects, check-ins, commitments, course viewing, chat messages and activity, sign-ins, the notifications we sent you, and your history as a member",
              "Until you ask us to remove it. If you leave and come back years later, your seat is still warm: your history is here.",
            ],
          },
          { id: "keep-usage", cells: ["Usage statistics: pages, buttons, search, and your device and screen", `${RETENTION.usageMonths} months, then only anonymous totals`] },
          {
            id: "keep-network",
            cells: [
              "Your exact IP address and your browser's identification string, as recorded when you visit, use the Hub or watch a course",
              `${RETENTION.rawNetworkDays} days. After that we keep the approximate place and the type of browser and device`,
            ],
          },
          { cells: ["Errors and screen recordings (of errors and of the sample of ordinary visits)", "Up to 90 days, set by our monitoring provider"] },
        ],
      },
      {
        kind: "p",
        id: "keep-deletes",
        text: [
          { strong: "When you delete something" },
          " you added to the Hub, it disappears for you and for everyone else. We may keep a copy, and our change history keeps a record of the change, until you ask us to close your account and remove it. When you ask, we either delete it or take your name off it. Removed data can stay in our database provider's backups for a limited time before they expire.",
        ],
      },
    ],
  },
  {
    id: "cookies",
    title: "Cookies and similar storage",
    blocks: [
      {
        kind: "p",
        text: "Most of what the Hub keeps on your device is there to make it work, so we don't need your consent for it, and you can clear it in your browser settings. In short:",
      },
      {
        kind: "list",
        items: [
          { text: [{ strong: "To make the Hub work:" }, " keeping you signed in, and remembering things like your last chat channel, your video speed and captions, and your recent searches."] },
          { text: [{ strong: "Your banner choice" }, " is remembered on your device."] },
          {
            text: [
              { strong: "Visit number" },
              ", only while usage statistics are on: a short-lived random number that groups the things you do in one visit. It expires after 30 minutes without activity and holds nothing about you.",
            ],
          },
          { text: [{ strong: "Google Analytics" }, " sets its own cookie, only if you have allowed it."] },
        ],
      },
    ],
  },
  {
    id: "services",
    title: "Services that help us run the Hub",
    blocks: [
      { kind: "p", text: "Your information passes through the services the Hub is built on. We use them to run the Hub and not for anything else." },
      {
        kind: "list",
        small: true,
        items: [
          { text: "Our database provider, our sign-in and auth provider, and our hosting provider (which also counts visits and page speed)." },
          { text: "Our monitoring providers, for errors and performance." },
          { text: "Our email provider, and your browser's push service if you turn on browser notifications." },
          { text: "Our video hosting provider, for course videos, and, only if usage statistics are on, for measuring how well they play." },
          { text: "Our payment and course providers, for your membership and billing." },
          { text: "Zoom, where live prickles happen, and how we know who joined and for how long." },
          { text: "Slack, for chat and notifications." },
          { text: "Our calendar service, for the prickle schedule, and our photo service, where event albums live and staff choose photos to bring into the Hub." },
          { text: "Google Analytics, only where you allow it." },
          { text: "Gravatar, which supplies a profile picture if you haven't set one; it is asked using a hash of your email address." },
        ],
      },
      {
        kind: "p",
        id: "services-transfers",
        text: "Our database and hosting are in the United States, so if you use the Hub from elsewhere your information is transferred there. Our providers are certified under the EU-U.S. Data Privacy Framework (and its UK extension) or we rely on standard contractual clauses with them.",
      },
    ],
  },
  {
    id: "more",
    title: "Also good to know",
    blocks: [
      {
        kind: "list",
        small: true,
        items: [
          { id: "more-sharing", text: [{ strong: "We don't share your information" }, " with anyone except the services above."] },
          { text: [{ strong: "Security:" }, " we take it seriously: connections are encrypted and staff access is limited by role."] },
          {
            id: "more-children",
            text: [{ strong: "Children:" }, " the Hub isn't for children under 13. If one has joined, email ", mail, " and we'll delete their information."],
          },
          { text: [{ strong: "Other sites" }, " that the Hub links to have their own privacy practices."] },
          { text: [{ strong: "Changes:" }, " we update the effective date above, and changes apply immediately."] },
        ],
      },
    ],
  },
  {
    id: "choices",
    title: "Your choices",
    blocks: [
      { kind: "subheading", text: "Usage statistics" },
      { kind: "switch", signedOut: ["Members can turn this off here once signed in. ", { link: "/login", text: "Sign in" }, "."] },
      {
        kind: "p",
        id: "consent-rule",
        text: [
          { strong: "If you are in the EU, EEA or UK" },
          " we ask before we start, with the banner at the bottom of the page, and if you decline we don't record any of this, apart from the error recordings described below. Elsewhere it is on until you turn it off here.",
        ],
      },
      {
        kind: "details",
        title: "How usage statistics work",
        paragraphs: [
          {
            id: "stats-no-typed-text",
            text: "We keep a log of how the Hub is used, so we can fix what is confusing and build what helps. It does not record what you type into search, forms or messages, and we take care that the button and link names it records are the app's own, such as “Save” or “Log progress”, not people's names or email addresses.",
          },
          {
            id: "stats-recordings",
            text: "If usage statistics are on, we also record a small share of visits as screen recordings, with text and form fields masked. Recordings made when something breaks are separate: they continue if you leave statistics off, because we can't fix a bug we can't see.",
          },
          {
            text: `Our hosting provider also counts visits and page speed in aggregate, as totals with no individual profile, and that count is not part of this switch. We use Google Analytics only where you have allowed it. The same switch and banner decide whether our video provider measures how well course videos play on your device (start time, buffering, errors). After ${RETENTION.usageMonths} months the individual records are removed and only anonymous totals remain (for example “this page was opened 300 times in March”), which is how we see trends over several years.`,
          },
        ],
      },
      { kind: "subheading", text: "Notifications" },
      {
        kind: "p",
        text: [
          "The Hub can notify you in more than one place, such as Slack, email, inside the Hub, or your browser. You choose which, for each kind of notification, in ",
          { link: "/settings/notifications", text: "Settings" },
          ", and every email has an unsubscribe link for that kind.",
        ],
      },
      { kind: "subheading", text: "Asking us" },
      {
        kind: "p",
        id: "choices-asking",
        text: [
          "You can ask us at any time to show you what we hold about you, correct it, remove it, or stop using it for usage statistics. Email ",
          mail,
          ". We will answer as soon as we can, and within a month. For removal we either delete it or take your name off it, so that it can no longer be tied to you.",
        ],
      },
    ],
  },
];

/** The contents links, in page order. */
export const PRIVACY_NAV: readonly { id: string; title: string }[] = [
  { id: "collect", title: "What we collect" },
  { id: "who-sees", title: "Who can see it" },
  { id: "chat", title: "Chat and messages" },
  { id: "keep", title: "How long we keep things" },
  { id: "cookies", title: "Cookies" },
  { id: "services", title: "Services we use" },
  { id: "more", title: "Also good to know" },
  { id: "choices", title: "Your choices" },
];

/** A table row as one line of words: its first cell, then the others labelled by their column. */
function rowText(columns: readonly string[], cells: readonly Rich[]): string {
  const [first, ...rest] = cells;
  return `${plainText(first)} (${rest.map((cell, i) => `${columns[i + 1]}: ${plainText(cell)}`).join("; ")})`;
}

export interface PrivacyUnit {
  id: string;
  /** The words the staff page shows as "Members read". */
  text: string;
  /** Each piece of text the member page shows verbatim for this item (a paragraph, or the cells of a row). */
  shown: readonly string[];
}

/** Every item with an id, in page order. */
export function privacyUnits(): PrivacyUnit[] {
  const units: PrivacyUnit[] = [];
  const add = (id: string | undefined, text: string, shown: readonly string[]) => {
    if (id) units.push({ id, text, shown });
  };
  for (const item of PRIVACY_SUMMARY) add(item.id, plainText(item.text), [plainText(item.text)]);
  for (const section of PRIVACY_SECTIONS) {
    for (const block of section.blocks) {
      if (block.kind === "p") add(block.id, plainText(block.text), [plainText(block.text)]);
      else if (block.kind === "table") for (const row of block.rows) add(row.id, rowText(block.columns, row.cells), row.cells.map(plainText));
      else if (block.kind === "details") for (const p of block.paragraphs) add(p.id, plainText(p.text), [plainText(p.text)]);
      else if (block.kind === "list") for (const item of block.items) add(item.id, plainText(item.text), [plainText(item.text)]);
    }
  }
  return units;
}

/** What the staff page shows as "Members read" for the given items: their text on the page, joined. Unknown ids throw. */
export function privacyText(ids: readonly string[]): string {
  const units = new Map(privacyUnits().map((u) => [u.id, u]));
  return ids
    .map((id) => {
      const unit = units.get(id);
      if (!unit) throw new Error(`src/content/privacy.ts has no item with id "${id}"`);
      return unit.text;
    })
    .join(" ");
}

/** All the words members read on the page (for the "names no provider" guard). */
export function privacyMemberText(): string[] {
  const out: string[] = [PRIVACY_TITLE, PRIVACY_TAGLINE, PRIVACY_SUMMARY_TITLE, ...PRIVACY_SUMMARY.map((u) => plainText(u.text))];
  for (const section of PRIVACY_SECTIONS) {
    out.push(section.title);
    for (const block of section.blocks) {
      if (block.kind === "p") out.push(plainText(block.text));
      else if (block.kind === "subheading") out.push(block.text);
      else if (block.kind === "table") out.push(...block.columns, ...block.rows.flatMap((r) => r.cells.map(plainText)));
      else if (block.kind === "details") out.push(block.title, ...block.paragraphs.map((p) => plainText(p.text)));
      else if (block.kind === "list") out.push(...block.items.map((i) => plainText(i.text)));
      else out.push(plainText(block.signedOut));
    }
  }
  return out;
}
