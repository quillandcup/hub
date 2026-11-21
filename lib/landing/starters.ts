import { FEATURED_COURSE, ORG_TIMEZONE } from "@/lib/config";
import type { LandingPageType } from "@/lib/data/landing-pages";
import type { LandingData } from "./data";
import { presetPadding } from "./layout";
import { stampLandingVersion } from "./migrations";

/**
 * Ready-made first drafts for "New page" (docs/product/LANDING_PAGES.md, "Starters"). A starter is the same Puck JSON the editor
 * saves, written once (here) and copied into a new draft page: from then on the page is the admin's, edited like any
 * other. Nothing in a starter is published, and it holds no member data, picture or invented fact: figures and
 * statuses are typed by hand (live data comes later), what only a person knows is left empty or in [brackets], and a
 * button with no known address keeps an empty link, which stops a publish until it is set.
 */

/** The organization's zone in words ("Eastern Time"), from `ORG_TIMEZONE`, so no zone is written in the starter. */
const orgZoneLabel = () => new Intl.DateTimeFormat("en-US", { timeZone: ORG_TIMEZONE, timeZoneName: "longGeneric" }).formatToParts(new Date()).find((part) => part.type === "timeZoneName")?.value ?? "";

let n = 0;
const id = (type: string) => `${type}-home${(n++).toString(36)}`;

const section = (props: Record<string, unknown>, content: unknown[]) => ({
  type: "Section",
  props: { id: id("Section"), background: "none", overlay: "none", width: "wide", ...presetPadding("medium"), hideOnDesktop: false, hideOnMobile: false, align: "center", card: false, fadeIn: false, ...props, content },
});
const heading = (text: string, level: "h1" | "h2" | "h3" = "h2", align: "left" | "center" = "center") => ({ type: "Heading", props: { id: id("Heading"), text, level, align } });
const text = (html: string, align: "left" | "center" = "center") => ({ type: "RichText", props: { id: id("RichText"), html, align } });
const button = (label: string, props: Record<string, unknown>) => ({ type: "Button", props: { id: id("Button"), label, href: "", look: "inherit", color: "plum", shape: "pill", align: "left", full: false, ...props } });
const columns = (props: Record<string, unknown>, cols: unknown[][]) => ({ type: "Columns", props: { id: id("Columns"), count: "2", gap: "medium", verticalAlign: "top", col1: cols[0] ?? [], col2: cols[1] ?? [], col3: cols[2] ?? [], ...props } });
const block = (type: string, props: Record<string, unknown>) => ({ type, props: { id: id(type), ...props } });
/** The items of a block that holds a list of them (a Finisher card, a week's day): child blocks, each with an id, for the parent's `items` slot. */
const items = (type: string, list: Record<string, unknown>[]) => list.map((props) => block(type, props));
const NO_LINK = { label: "", href: "" };
/** One program under a Journey map stage; the link stays empty unless given, so the publish check asks for it. `featured` leads the stage's panel. */
const offer = (status: "open" | "waitlist" | "soon" | "dates", statusLabel: string, title: string, text: string, buttonLabel: string, href = "", featured = false) => ({ status, statusLabel, title, text, buttonLabel, href, featured });

/**
 * The program copy of the journey map (written with the owner's facts: no prices, no dates, nothing about a program that isn't known).
 * Each says what the program is for in a sentence or two. What is true of a program is only: Membership (daily prickles, a community
 * that notices when you're missing, tools for words, goals and streaks); The Ready Writer (a book in a year, one year from purchase,
 * membership included, a plan and a pace); The 180 Program (a draft in six months, in a cohort, membership included); Self-Editing
 * Academy (cohort, reflection exercises and levels, membership not included); retreats (in person or online).
 */
const COPY = {
  membership: "Show up to a prickle any day, and someone is already writing beside you. Track your words, keep your streak, and be noticed when you're missing.",
  readyWriter: "Write your book in a year with a plan, a pace and a prickle to show up to. Membership is included, so you're never writing alone.",
  oneEighty: "Finish your draft in six months, alongside a cohort of writers moving through the same stretch. The faster path, with membership included.",
  // The owner's own line for it: "critique partner" sounds scary, so we call them friends.
  feedbackFriends: "Because “critique partner” sounds scary. Friendly, honest feedback from fellow writers.",
  selfEditing: "Learn to edit your own manuscript alongside a cohort, with reflection exercises and levels that show how far you've come.",
  retreats: "Write, learn and be with your people, in person or from home.",
  published: "When you type THE END, you become a Finisher, and the whole house celebrates.",
} as const;

/**
 * The homepage as reviewed with the owner: announcement strip, an opening band with the pitch beside the day's
 * schedule, outcome numbers, Finishers, a day in the house, the first week, finish lines, the journey map and what is
 * coming up, then a sign-up. The opening band is a plum Section holding two Columns (the Hero block has no second
 * column), and its headline is the page's one h1. Sections default to Medium space; only the closing sign-up is airy.
 */
function homeContent(): unknown[] {
  n = 0;
  return [
    // Live from the Hub on the published page and in Preview (this typed text shows only if no prickle is coming up or the read fails).
    block("AnnouncementStrip", { text: "Your next prickle starts in 42 minutes", buttonLabel: "Drop in", href: "", tone: "gold", source: "live" }),
    // The opening band: the pitch on the left, today's schedule beside it (stacked on a narrow page, side by side from the split size).
    section({ background: "plum", width: "wide", align: "left" }, [
      columns({ count: "2", gap: "large", verticalAlign: "center" }, [
        [
          heading("THE END is the best two words in the English language.", "h1", "left"),
          text("<p>We help writers get there, and we celebrate every Finisher who does. Someone is always writing beside you, and someone notices when you're missing.</p>", "left"),
          block("ButtonRow", {
            items: items("RowButton", [
              { label: "Start your first prickle", href: "", look: "inherit", color: "light", shape: "pill" },
              { label: "Drop in now", href: "", look: "outline", color: "light", shape: "pill" },
            ]),
            align: "left",
            gap: "medium",
          }),
          text("<p>Small, friendly groups, with no pressure to turn your camera on.</p>", "left"),
        ],
        [
          block("SchedulePanel", {
            title: "Writing right now",
            // Live: the next upcoming prickles; the typed rows below are the fallback and what the editor canvas shows.
            source: "live",
            hostStyle: "experience",
            // No chip on ordinary rows (the same chip on every row says nothing); what is true of every session goes once under the list.
            openLabel: "",
            rowNote: "",
            footer: "Camera optional. Chat optional. Everyone is welcome.",
            zoneLabel: orgZoneLabel(),
            items: items("ScheduleRow", [
              { time: "9:00 am", title: "Morning pages", status: "Live", state: "live", host: "Hosted by [Host name], who has hosted [number] prickles." },
              { time: "10:00 am", title: "Focus hour", status: "In 42 min", state: "soon", host: "" },
              { time: "12:30 pm", title: "Lunch hour", status: "", state: "open", host: "Hosted by [Host name] · first-timers welcome" },
              { time: "8:00 pm", title: "Night owls", status: "", state: "open", host: "" },
            ]),
          }),
        ],
      ]),
    ]),
    block("OutcomeNumbers", {
      items: items("OutcomeNumber", [
        // Live: the Bookshelf's count of books members have published; the typed figure shows if it can't be read.
        { source: "live", stat: "books_published", value: "50+", label: "", note: "" },
        { source: "manual", stat: "hours_30d", value: "100s", label: "of Finishers who typed THE END", note: "" },
        // Live from the Hub once the page is published ("Live from the Hub" in the block's settings); the typed figure is only what shows if it can't be read.
        { source: "live", stat: "hours_30d", value: "[number]", label: "", note: "" },
        { source: "live", stat: "words_30d", value: "[number]", label: "", note: "" },
      ]),
    }),
    section({ background: "none" }, [
      heading("Meet the Finishers"),
      text("<p>Every one of them started with a blank page and an idea.</p>"),
      block("FinisherCards", {
        items: items(
          "FinisherCard",
          [0, 1, 2].map(() => ({ alt: "", name: "[Name]", kind: "[Kind of book]", dayOne: "[Where she started]", theEnd: "[What she finished, and how long it took]", linkLabel: "Read her story", href: "" })),
        ),
        more: { label: "See every Finisher", href: "" },
      }),
    ]),
    section({ background: "blush" }, [
      heading("A day in the Hedgie House"),
      block("Timeline", {
        heading: "",
        intro: "You're never writing alone, and you're never invisible. We know each other's characters like the neighborhood kids.",
        items: items("TimelineMoment", [
          { when: "8:00 am", title: "Morning pages", text: "Maya joins before work. Four others are writing. Nobody talks. Everyone is there." },
          { when: "Noon", title: "Chat", text: "A thread about stubborn middles. Someone shares what worked." },
          { when: "Thursday", title: "Where's Maya?", text: "You miss your usual 8:00. By lunch, someone has checked on you." },
          { when: "Week six", title: "Streak", text: "The house notices, and so do you." },
        ]),
        closing: "",
      }),
    ]),
    section({ background: "none" }, [
      heading("Your first week, so nothing is a surprise"),
      block("WeekStrip", {
        subtitle: "Camera optional. Chat optional. Five minutes to join.",
        items: items("WeekDay", [
          { label: "Mon", emoji: "👋", text: "Drop into a prickle", note: "20 seconds of courage" },
          { label: "Tue", emoji: "✍️", text: "Write & log progress", note: "about 45 min" },
          { label: "Wed", emoji: "🎯", text: "Set one small goal", note: "2 min" },
          { label: "Thu", emoji: "💬", text: "Say hello in chat", note: "5 minute intro" },
          { label: "Fri", emoji: "🔥", text: "Your first streak day", note: "we'll cheer" },
        ]),
      }),
      button("Start your first prickle", { align: "center" }),
    ]),
    section({ background: "brown" }, [
      heading("Pick a finish line"),
      text("<p>A plan, a steady pace, and Hedgies beside you all the way.</p>"),
      block("FinishLineCards", {
        items: items("FinishLineCard", [
          { title: "THE END in a year", program: "The Ready Writer", text: "A steady plan to a finished book.", durationLabel: "12 months", durationPercent: 100, buttonLabel: "See The Ready Writer", href: FEATURED_COURSE.offerUrl },
          { title: "THE END in six months", program: "The 180 Program (Accelerated)", text: "Faster, with more support.", durationLabel: "6 months", durationPercent: 50, buttonLabel: "See The 180 Program", href: "" },
        ]),
      }),
      block("PlanPhases", {
        heading: "What the first 12 weeks look like",
        items: items("PlanPhase", [
          { title: "Weeks 1–4", text: "Build the habit with your group." },
          { title: "Weeks 5–8", text: "Find your pace; share a scene for feedback." },
          { title: "Weeks 9–12", text: "Plan the middle; celebrate the halfway mark." },
        ]),
      }),
    ]),
    section({ background: "cream" }, [
      heading("Wherever your book is, there's a next step"),
      // One panel per stage: the first offer (or the one marked featured) is large, the rest are a short list of links.
      block("JourneyMap", {
        stages: [
          { name: "Idea", helps: "Membership", current: false, note: "", link: NO_LINK, offers: [offer("open", "", "Membership", COPY.membership, "See membership", "", true)] },
          {
            name: "Drafting",
            helps: "The Ready Writer · The 180 Program (Accelerated)",
            current: false,
            note: "",
            link: NO_LINK,
            offers: [
              offer("waitlist", "", "The Ready Writer", COPY.readyWriter, "See The Ready Writer", FEATURED_COURSE.offerUrl, true),
              offer("open", "", "The 180 Program (Accelerated)", COPY.oneEighty, "See The 180 Program"),
              offer("open", "", "Best Feedback Friends", COPY.feedbackFriends, "See Best Feedback Friends"),
            ],
          },
          {
            name: "Revising",
            helps: "Self-Editing Academy · Best Feedback Friends",
            current: true,
            note: "",
            link: NO_LINK,
            offers: [
              offer("open", "", "Self-Editing Academy", COPY.selfEditing, "See Self-Editing Academy", "", true),
              offer("open", "", "Best Feedback Friends", COPY.feedbackFriends, "See Best Feedback Friends"),
            ],
          },
          {
            name: "Sharing",
            helps: "Retreats and Virtual Retreats",
            current: false,
            note: "",
            link: NO_LINK,
            offers: [offer("open", "", "Retreats and Virtual Retreats", COPY.retreats, "See retreats", "", true)],
          },
          { name: "Published", helps: "Celebrate with the Finishers", current: false, note: COPY.published, link: NO_LINK, offers: [] },
        ],
        compare: { label: "Compare all programs", href: "" },
      }),
    ]),
    // On the page colour (no dark band): big events as tall picture tiles beside a plain dated list of sessions. Both are live from the Hub.
    section({ background: "white" }, [
      heading("Coming up"),
      columns({ count: "2", gap: "large", verticalAlign: "top" }, [
        [
          block("ComingUp", {
            heading: "",
            style: "feature",
            // Live: upcoming events announced publicly, of these kinds; the typed tiles are the fallback and what the editor canvas shows.
            source: "live",
            kinds: ["in_person_retreat", "virtual_retreat", "workshop"],
            max: 2,
            more: NO_LINK,
            // Shown on a sold-out event, once the address is set.
            waitlist: { label: "Join the waitlist", href: "" },
            items: [
              { kind: "Retreat", title: "[Name]", when: "[Dates · place]", availability: "[Spots left]", status: "", linkLabel: "", href: "" },
              { kind: "Virtual retreat", title: "[Name]", when: "[Dates]", availability: "[Spots left]", status: "", linkLabel: "", href: "" },
            ],
          }),
        ],
        [
          block("ComingUp", {
            heading: "Upcoming sessions",
            style: "list",
            source: "live",
            kinds: ["session", "social", "book_launch", "educational", "other"],
            max: 4,
            more: { label: "See all events", href: "" },
            waitlist: NO_LINK,
            items: [{ kind: "Session", title: "[Name]", when: "[Date and time]", date: "", time: "", availability: "", status: "", linkLabel: "", href: "" }],
          }),
        ],
      ]),
    ]),
    section({ background: "plum", width: "narrow", ...presetPadding("large") }, [
      heading("Your name could be on the wall."),
      text("<p>Hedgies at every stage cheer each other across the line.</p>"),
      // The Kajabi form is the owner's to choose in the editor (Kajabi, Marketing, Forms); empty here on purpose, so the publish check asks for it.
      block("OptInForm", { kajabiFormId: "", instagramField: "none", buttonLabel: "Get my first prickle", reassurance: "No spam. Unsubscribe any time.", successMessage: "Thank you! Please check your email.", href: "", look: "inherit", color: "light", shape: "pill" }),
    ]),
  ];
}

export type StarterKey = "home";

export const LANDING_STARTERS: Record<StarterKey, { label: string; title: string; slug: string; description: string; pageType: LandingPageType }> = {
  home: { pageType: "website", label: "Homepage", title: "Quill & Cup", slug: "home", description: "The public front door: this week's prickles, Finishers, a day in the house, the first week and the next step." },
};

export const STARTER_KEYS = Object.keys(LANDING_STARTERS) as StarterKey[];

export const isStarterKey = (value: unknown): value is StarterKey => typeof value === "string" && (STARTER_KEYS as string[]).includes(value);

/** A fresh copy of a starter's page (new each call, so a draft never shares objects with another). */
export function starterData(key: StarterKey): LandingData {
  const content = key === "home" ? homeContent() : [];
  return stampLandingVersion({
    content,
    root: {
      props: {
        showHeader: false,
        showFooter: true,
        navLinks: [],
        footerText: "Quill & Cup. Write together. Show up. Write. Celebrate. Repeat.",
        footerLinks: [
          { label: "Member sign in", href: "/login" },
          { label: "Privacy", href: "/privacy" },
          { label: "Security", href: "/security" },
          { label: "Compliance", href: "/compliance" },
        ],
      },
    },
  }) as LandingData;
}
