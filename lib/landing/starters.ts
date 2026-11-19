import type { LandingData } from "./data";
import { stampLandingVersion } from "./migrations";

/**
 * Ready-made first drafts for "New page" (docs/LANDING_PAGES.md, "Starters"). A starter is the same Puck JSON the editor
 * saves, written once (here, first drafted with AI) and copied into a new draft page: from then on the page is
 * the admin's, edited like any other. Nothing in a starter is published, and it holds no member data, picture or
 * invented fact: the lines say what the Hub does today, and the places only a person can fill in (the address of the
 * join button) are left empty, which stops a publish until they are set.
 */

let n = 0;
const id = (type: string) => `${type}-home${(n++).toString(36)}`;

const section = (props: Record<string, unknown>, content: unknown[]) => ({
  type: "Section",
  props: { id: id("Section"), background: "none", overlay: "none", width: "wide", padding: "large", align: "center", card: false, fadeIn: false, ...props, content },
});
const heading = (text: string, level: "h1" | "h2" | "h3" = "h2", align: "left" | "center" = "center") => ({ type: "Heading", props: { id: id("Heading"), text, level, align } });
const text = (html: string, align: "left" | "center" = "center") => ({ type: "RichText", props: { id: id("RichText"), html, align } });

function homeContent(): unknown[] {
  n = 0;
  return [
    {
      type: "Hero",
      props: {
        id: id("Hero"),
        headline: "Writing is better together",
        level: "h1",
        subhead:
          "Quill & Cup is a community of writers who show up for each other. Write alongside others in focused sessions every day, keep track of your progress, and have people cheering you on until the book is done.",
        // The join address is not known to the draft: left empty on purpose, so the publish check asks for it.
        primary: { label: "Join the Hedgie House", href: "" },
        secondary: { label: "Member sign in", href: "/login" },
        alt: "",
        decorative: false,
        imageMode: "background",
        overlay: "dark",
        background: "plum",
        align: "center",
      },
    },
    section({ background: "cream", width: "medium", fadeIn: true }, [
      heading("Writing alone is hard. You don't have to."),
      text(
        "<p>Most books are written in small pockets of time, and most writers start strong and then drift. What brings people back is company: a time to show up, others writing at the same moment, and someone noticing when you do.</p><p>That is what we built. A warm, steady rhythm that makes the next page easier to start.</p>",
      ),
    ]),
    section({ background: "white" }, [
      {
        type: "Steps",
        props: {
          id: id("Steps"),
          heading: "How it works",
          items: [
            { title: "Pick a prickle", text: "A prickle is a focused writing session with fellow Hedgies on Zoom. There is one on the schedule all day, every day, so there is a time that fits your week." },
            { title: "Show up and write", text: "Say hello, set your goal for the session, and write together. Check in before and out after, and say how it went." },
            { title: "Watch it add up", text: "Log your words, keep your streak going and see your project take shape, with a community that celebrates every step." },
          ],
        },
      },
    ]),
    section({ background: "none" }, [
      heading("Everything you need to keep writing, in one place"),
      {
        type: "CardGrid",
        props: {
          id: id("CardGrid"),
          columns: "3",
          items: [
            { alt: "", icon: "✍️", title: "Prickles", description: "Focused writing sessions with other writers, all day, every day. Join one for the hour or commit to the times that suit you.", price: "", buttonLabel: "", href: "" },
            { alt: "", icon: "📅", title: "Your own calendar", description: "Every prickle you plan appears in Google, Apple or Outlook calendar, with the Zoom link and a reminder before it starts.", price: "", buttonLabel: "", href: "" },
            { alt: "", icon: "📈", title: "Projects, goals and progress", description: "Keep each book in one place, set goals, log your words after a session and see your progress build.", price: "", buttonLabel: "", href: "" },
            { alt: "", icon: "🔥", title: "Streaks", description: "Show up week after week and watch your streak grow. A gentle nudge, never a scolding, if one lapses.", price: "", buttonLabel: "", href: "" },
            { alt: "", icon: "💬", title: "Chat with fellow writers", description: "Conversations about craft, progress and the day's prickle, right in the Hub and in step with our Slack.", price: "", buttonLabel: "", href: "" },
            { alt: "", icon: "🎓", title: "Courses and events", description: "Learn the craft in courses, join community events and find the people writing what you love to read.", price: "", buttonLabel: "", href: "" },
          ],
        },
      },
    ]),
    section({ background: "blush", width: "medium" }, [
      heading("Made for writers like you"),
      {
        type: "List",
        props: {
          id: id("List"),
          items: [
            { text: "You are drafting your first book and want company while you do it.", icon: "✓" },
            { text: "You have an unfinished manuscript that needs a reason to come off the shelf.", icon: "✓" },
            { text: "You fit your writing around work, family and everything else.", icon: "✓" },
            { text: "You want a place that is kind, steady and about the words.", icon: "✓" },
          ],
          align: "left",
        },
      },
    ]),
    section({ background: "none", width: "medium" }, [
      heading("Good to know"),
      {
        type: "Faq",
        props: {
          id: id("Faq"),
          items: [
            { question: "What is a prickle?", answer: "A prickle is a focused writing sprint with other writers, held on Zoom. Hedgies use the word because a group of hedgehogs is called a prickle." },
            { question: "Do I have to be a published author?", answer: "No. Come with a book, a draft, an idea or a habit you want to build. Everyone is welcome at every stage." },
            { question: "What if my week is unpredictable?", answer: "There is a prickle on the schedule all day, every day, and each one shows in your own time zone. Pick the ones that fit, when they fit." },
            { question: "Can I use it on my phone?", answer: "Yes. The Hub works on your phone, and your reminders can come by Slack, email or on your phone, as you choose." },
          ],
        },
      },
    ]),
    {
      type: "CtaBanner",
      props: {
        id: id("CtaBanner"),
        heading: "Ready to write with us?",
        text: "Come to your first prickle and see how much easier the next page feels.",
        label: "Join the Hedgie House",
        href: "",
        background: "plum",
        align: "center",
      },
    },
  ];
}

export type StarterKey = "home";

export const LANDING_STARTERS: Record<StarterKey, { label: string; title: string; slug: string; description: string }> = {
  home: { label: "Homepage", title: "Quill & Cup", slug: "home", description: "The public front door: what Quill & Cup is, how it works and what members get." },
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
          { label: "Privacy", href: "/privacy" },
          { label: "Security", href: "/security" },
          { label: "Compliance", href: "/compliance" },
        ],
      },
    },
  }) as LandingData;
}
