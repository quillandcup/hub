import { ORG_TIMEZONE } from "@/lib/config";
import type { LandingData } from "./data";
import { stampLandingVersion } from "./migrations";

/**
 * Ready-made first drafts for "New page" (docs/LANDING_PAGES.md, "Starters"). A starter is the same Puck JSON the editor
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
  props: { id: id("Section"), background: "none", overlay: "none", width: "wide", padding: "medium", align: "center", card: false, fadeIn: false, ...props, content },
});
const heading = (text: string, level: "h1" | "h2" | "h3" = "h2", align: "left" | "center" = "center") => ({ type: "Heading", props: { id: id("Heading"), text, level, align } });
const text = (html: string, align: "left" | "center" = "center") => ({ type: "RichText", props: { id: id("RichText"), html, align } });
const button = (label: string, props: Record<string, unknown>) => ({ type: "Button", props: { id: id("Button"), label, href: "", look: "solid", color: "plum", shape: "pill", align: "left", full: false, ...props } });
const columns = (props: Record<string, unknown>, cols: unknown[][]) => ({ type: "Columns", props: { id: id("Columns"), count: "2", gap: "medium", verticalAlign: "top", col1: cols[0] ?? [], col2: cols[1] ?? [], col3: cols[2] ?? [], ...props } });
const block = (type: string, props: Record<string, unknown>) => ({ type, props: { id: id(type), ...props } });

/**
 * The homepage as reviewed with the owner: announcement strip, an opening band with the pitch beside the day's
 * schedule, outcome numbers, Finishers, a day in the house, the first week, finish lines, the journey map and what is
 * coming up, then a sign-up. The opening band is a plum Section holding two Columns (the Hero block has no second
 * column), and its headline is the page's one h1. Sections default to Medium space; only the closing sign-up is airy.
 */
function homeContent(): unknown[] {
  n = 0;
  return [
    block("AnnouncementStrip", { text: "Your next prickle starts in 42 minutes", buttonLabel: "Drop in", href: "", tone: "gold" }),
    // The opening band: the pitch on the left, today's schedule beside it (stacked on a narrow page, side by side from the split size).
    section({ background: "plum", width: "wide", padding: "medium", align: "left" }, [
      columns({ count: "2", gap: "large", verticalAlign: "center" }, [
        [
          heading("THE END is the best two words in the English language.", "h1", "left"),
          text("<p>We help writers get there, and we celebrate every Finisher who does. Someone is always writing beside you, and someone notices when you're missing.</p>", "left"),
          block("ButtonRow", {
            items: [
              { label: "Start your first prickle", href: "", look: "solid", color: "light", shape: "pill" },
              { label: "Drop in now", href: "", look: "outline", color: "light", shape: "pill" },
            ],
            align: "left",
            gap: "medium",
          }),
          text("<p>Small, friendly groups, with no pressure to turn your camera on.</p>", "left"),
        ],
        [
          block("SchedulePanel", {
            title: "Writing right now",
            zoneLabel: orgZoneLabel(),
            rows: [
              { time: "9:00 am", title: "Morning pages", status: "Live", state: "live", host: "Hosted by [Host name], who has hosted [number] prickles." },
              { time: "10:00 am", title: "Focus hour", status: "In 42 min", state: "soon", host: "" },
              { time: "12:30 pm", title: "Lunch hour", status: "Open", state: "open", host: "Hosted by [Host name] · first-timers welcome" },
              { time: "8:00 pm", title: "Night owls", status: "Camera optional", state: "open", host: "" },
            ],
          }),
        ],
      ]),
    ]),
    block("OutcomeNumbers", {
      items: [
        { value: "50+", label: "books published by members in 5 years", note: "" },
        { value: "100s", label: "of Finishers who typed THE END", note: "" },
        // Live from the Hub once the page is published ("Live from the Hub" in the block's settings); the typed figure is only what shows if it can't be read.
        { source: "live", stat: "words_30d", value: "[number]", label: "", note: "" },
      ],
    }),
    section({ background: "none" }, [
      heading("Meet the Finishers"),
      text("<p>Every one of them started with a blank page and an idea.</p>"),
      block("FinisherCards", {
        items: [
          { alt: "", name: "[Name]", kind: "[Kind of book]", dayOne: "[Where she started]", theEnd: "[What she finished, and how long it took]", linkLabel: "Read her story", href: "" },
          { alt: "", name: "[Name]", kind: "[Kind of book]", dayOne: "[Where she started]", theEnd: "[What she finished, and how long it took]", linkLabel: "Read her story", href: "" },
          { alt: "", name: "[Name]", kind: "[Kind of book]", dayOne: "[Where she started]", theEnd: "[What she finished, and how long it took]", linkLabel: "Read her story", href: "" },
        ],
        more: { label: "See every Finisher", href: "" },
      }),
    ]),
    section({ background: "blush" }, [
      heading("A day in the Hedgie House"),
      block("Timeline", {
        heading: "",
        intro: "You're never writing alone, and you're never invisible. We know each other's characters like the neighborhood kids.",
        items: [
          { when: "8:00 am", title: "Morning pages", text: "Maya joins before work. Four others are writing. Nobody talks. Everyone is there." },
          { when: "Noon", title: "Chat", text: "A thread about stubborn middles. Someone shares what worked." },
          { when: "Thursday", title: "Where's Maya?", text: "You miss your usual 8:00. By lunch, someone has checked on you." },
          { when: "Week six", title: "Streak", text: "The house notices, and so do you." },
        ],
        closing: "",
      }),
    ]),
    section({ background: "none" }, [
      heading("Your first week, so nothing is a surprise"),
      block("WeekStrip", {
        subtitle: "Camera optional. Chat optional. Five minutes to join.",
        items: [
          { label: "Mon", emoji: "👋", text: "Drop into a prickle", note: "5 min to join" },
          { label: "Tue", emoji: "🎯", text: "Set one small goal", note: "2 min" },
          { label: "Wed", emoji: "✍️", text: "Write, then log your words", note: "about 45 min" },
          { label: "Thu", emoji: "🔥", text: "Your first streak day", note: "we'll cheer" },
          { label: "Fri", emoji: "💬", text: "Say hello in chat", note: "or not yet" },
        ],
      }),
      button("Start your first prickle", { align: "center" }),
    ]),
    section({ background: "brown" }, [
      heading("Pick a finish line"),
      text("<p>A plan, a steady pace, and Hedgies beside you all the way.</p>"),
      block("FinishLineCards", {
        items: [
          { title: "THE END in a year", program: "The Ready Writer", text: "A steady plan to a finished book.", durationLabel: "12 months", durationPercent: 100, buttonLabel: "See The Ready Writer", href: "" },
          { title: "THE END in six months", program: "The 180 Program (Accelerated)", text: "Faster, with more support.", durationLabel: "6 months", durationPercent: 50, buttonLabel: "See The 180 Program", href: "" },
        ],
      }),
      block("PlanPhases", {
        heading: "What the first 12 weeks look like",
        items: [
          { title: "Weeks 1–4", text: "Build the habit with your group." },
          { title: "Weeks 5–8", text: "Find your pace; share a scene for feedback." },
          { title: "Weeks 9–12", text: "Plan the middle; celebrate the halfway mark." },
        ],
      }),
    ]),
    section({ background: "cream" }, [
      heading("Wherever your book is, there's a next step"),
      block("JourneyMap", {
        stages: [
          { name: "Idea", helps: "Membership", current: false },
          { name: "Drafting", helps: "The Ready Writer · The 180 Program (Accelerated)", current: false },
          { name: "Revising", helps: "Self-Editing Academy · Best Feedback Friends", current: true },
          { name: "Sharing", helps: "Retreats and Virtual Retreats", current: false },
          { name: "Published", helps: "Celebrate with the Finishers", current: false },
        ],
        offer: { status: "open", statusLabel: "", title: "Self-Editing Academy", text: "[One-line description.]", buttonLabel: "See Self-Editing Academy", href: "" },
        compare: { label: "Compare all programs", href: "" },
      }),
      block("ComingUp", {
        heading: "Coming up",
        items: [
          { kind: "Retreat", title: "[Name]", when: "[Dates · place]", availability: "[Spots left]", status: "", linkLabel: "", href: "" },
          { kind: "Virtual retreat", title: "[Name]", when: "[Dates]", availability: "[Spots left]", status: "", linkLabel: "", href: "" },
          { kind: "Challenge", title: "[Name]", when: "[Starts on date]", availability: "[Spots left]", status: "", linkLabel: "", href: "" },
        ],
      }),
    ]),
    section({ background: "plum", width: "narrow", padding: "large" }, [
      heading("Your name could be on the wall."),
      text("<p>Hedgies at every stage cheer each other across the line.</p>"),
      // The Kajabi form is the owner's to choose in the editor (Kajabi, Marketing, Forms); empty here on purpose, so the publish check asks for it.
      block("OptInForm", { kajabiFormId: "", instagramField: "none", buttonLabel: "Get my first prickle", reassurance: "No spam. Unsubscribe any time.", successMessage: "Thank you! Please check your email.", href: "", look: "solid", color: "light", shape: "pill" }),
    ]),
  ];
}

export type StarterKey = "home";

export const LANDING_STARTERS: Record<StarterKey, { label: string; title: string; slug: string; description: string }> = {
  home: { label: "Homepage", title: "Quill & Cup", slug: "home", description: "The public front door: this week's prickles, Finishers, a day in the house, the first week and the next step." },
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
