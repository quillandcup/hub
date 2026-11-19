import type { ComponentConfig, Config } from "@puckeditor/core";
import type { ReactNode } from "react";
import { safeHref } from "@/lib/landing/data";
import {
  Button,
  CardGrid,
  Columns,
  CountdownBlock,
  CtaBanner,
  Divider,
  Faq,
  Heading,
  Hero,
  Image,
  LinkList,
  List,
  OptInFormBlock,
  RichText,
  Section,
  Spacer,
  Split,
  Stats,
  Steps,
  Testimonials,
  Video,
} from "./blocks";
import {
  AnnouncementStrip,
  ComingUp,
  FinishLineCards,
  FinisherCards,
  JourneyMap,
  OutcomeNumbers,
  PlanPhases,
  SchedulePanel,
  Timeline,
  WeekStrip,
} from "./homepage-blocks";
import { pageImage } from "./theme";

/**
 * The block set and the page frame, with no editor-only parts: the public page renders `data` through this (on the
 * server), and the editor builds its own config from it by adding each block's fields (editor-config.tsx). A new
 * block is: a component in blocks.tsx, an entry here with its default props, and its fields in editor-config.tsx.
 * See docs/LANDING_PAGES.md, "Adding a block".
 */

// Puck types each component's props from its config; our blocks are plain components, so they are registered loosely.
const block = <P,>(config: { label: string; defaultProps: P; render: (props: P) => ReactNode; fields?: Record<string, { type: string }> }) => config as unknown as ComponentConfig;

export type RootProps = {
  showHeader?: boolean;
  logoAssetId?: string;
  logoAlt?: string;
  logoHref?: string;
  navLinks?: { label: string; href: string }[];
  showFooter?: boolean;
  footerText?: string;
  footerLinks?: { label: string; href: string }[];
};

const LINK_ROW = "px-2 py-1 text-sm underline-offset-4 hover:underline";

/** The frame around every page: an optional header (logo and links), the blocks, an optional footer. Where `@container` lives, so blocks respond to the room they have. */
export function PageFrame({ children, ...root }: RootProps & { children?: ReactNode }) {
  const logo = pageImage(root.logoAssetId, "event_card");
  const nav = (root.navLinks ?? []).filter((l) => l.label && safeHref(l.href));
  const footerLinks = (root.footerLinks ?? []).filter((l) => l.label && safeHref(l.href));
  return (
    // The page colour (`page`: the brand canvas, or slate in dark mode), light or dark with the theme (the app's dark mode, or the visitor's system setting); never `bg-background`, which is the app's grey.
    // Light bands (`landing-light`) stay light in dark mode.
    <div className="@container min-h-screen bg-page text-ink">
      {root.showHeader && (logo || nav.length > 0) && (
        <header className="bg-card">
          <div className="mx-auto flex max-w-5xl flex-col items-center gap-3 px-4 py-4 @pair:flex-row @pair:justify-between">
            {logo && (
              <a href={safeHref(root.logoHref) || "/"} className="shrink-0">
                {/* eslint-disable-next-line @next/next/no-img-element -- served by the media route */}
                <img src={logo} alt={root.logoAlt || ""} className="h-12 w-auto" />
              </a>
            )}
            {nav.length > 0 && (
              <nav aria-label="Page">
                <ul className="flex flex-wrap justify-center gap-1">
                  {nav.map((l, i) => (
                    <li key={i}>
                      <a href={safeHref(l.href)} className={LINK_ROW}>
                        {l.label}
                      </a>
                    </li>
                  ))}
                </ul>
              </nav>
            )}
          </div>
        </header>
      )}
      <main>{children}</main>
      {root.showFooter && (root.footerText || footerLinks.length > 0) && (
        <footer className="bg-cup px-4 py-6 text-center text-sm text-white">
          {footerLinks.length > 0 && (
            <ul className="mb-2 flex flex-wrap justify-center gap-1">
              {footerLinks.map((l, i) => (
                <li key={i}>
                  <a href={safeHref(l.href)} className={LINK_ROW}>
                    {l.label}
                  </a>
                </li>
              ))}
            </ul>
          )}
          {root.footerText && <p>{root.footerText}</p>}
        </footer>
      )}
    </div>
  );
}

const rootConfig = {
  defaultProps: { showHeader: false, showFooter: false, navLinks: [], footerLinks: [], footerText: "" },
  render: PageFrame,
};

export const BLOCK_DEFAULTS = {
  Section: { background: "none", overlay: "none", width: "wide", padding: "medium", align: "left", card: false, fadeIn: false },
  Columns: { count: "2", gap: "medium", verticalAlign: "top" },
  RichText: { html: "<p>Write something here.</p>", align: "left" },
  Heading: { text: "A heading", level: "h2", align: "center" },
  Button: { label: "Join us", href: "", look: "solid", color: "plum", shape: "pill", align: "center", full: false },
  Image: { alt: "", decorative: false, size: "medium", rounded: true, align: "center" },
  Split: { alt: "", decorative: false, imageSide: "left", html: "<h2>A heading</h2><p>Tell the story next to the picture.</p>" },
  List: { items: [{ text: "First thing", icon: "✓" }, { text: "Second thing", icon: "✓" }], align: "left" },
  Testimonials: { items: [{ quote: "What a difference this made.", name: "A member", detail: "Member since 2024" }] },
  Faq: { items: [{ question: "A question?", answer: "The answer." }] },
  Countdown: { targetAt: "", heading: "Starts in", whenExpired: "message", expiredMessage: "It has started." },
  CardGrid: { columns: "3", items: [{ alt: "", title: "A title", price: "$20", buttonLabel: "Buy now", href: "" }] },
  LinkList: { items: [{ label: "A link", href: "" }], look: "solid", color: "plum" },
  Divider: { look: "short" },
  Spacer: { size: "medium" },
  Video: { url: "", title: "" },
  Hero: { headline: "A headline that says what you offer", level: "h1", subhead: "One or two lines that say who it is for and why it helps.", primary: { label: "Join us", href: "" }, secondary: { label: "", href: "" }, alt: "", decorative: false, imageMode: "background", overlay: "dark", background: "plum", align: "center", padding: "large" },
  Steps: { heading: "How it works", items: [{ title: "Sign up", text: "Tell us a little about you." }, { title: "Join in", text: "Come to your first session." }, { title: "Keep going", text: "Write a little each day." }] },
  Stats: { items: [{ value: "1,000", label: "words written a day" }, { value: "24/7", label: "company" }, { value: "3", label: "sessions a week" }] },
  CtaBanner: { heading: "Ready to start?", text: "", label: "Join us", href: "", background: "plum", align: "center" },
  OptInForm: { kajabiFormId: "", instagramField: "none", buttonLabel: "Sign me up", reassurance: "No spam. Unsubscribe any time.", successMessage: "Thank you! Please check your email.", href: "", look: "solid", color: "plum", shape: "pill" },
  // Homepage blocks (components/landing/homepage-blocks.tsx): typed by hand, no live data yet.
  AnnouncementStrip: { text: "Your next prickle starts soon", buttonLabel: "Drop in", href: "", tone: "gold" },
  SchedulePanel: {
    title: "Writing right now",
    zoneLabel: "",
    rows: [
      { time: "9:00 am", title: "Morning pages", status: "Live", state: "live", host: "" },
      { time: "10:00 am", title: "Focus hour", status: "In 42 min", state: "soon", host: "" },
      { time: "12:30 pm", title: "Lunch hour", status: "Camera optional", state: "open", host: "" },
    ],
  },
  OutcomeNumbers: { padding: "medium", items: [{ value: "50+", label: "books published by members", note: "" }, { value: "100s", label: "of Finishers", note: "" }] },
  FinisherCards: { items: [{ alt: "", name: "Name", kind: "Kind of book", dayOne: "Where she started", theEnd: "What she finished", linkLabel: "Read her story", href: "" }], more: { label: "", href: "" } },
  Timeline: { heading: "", intro: "", items: [{ when: "8:00 am", title: "Morning pages", text: "What happens, in a line or two." }], closing: "" },
  WeekStrip: { subtitle: "", items: [{ label: "Mon", emoji: "👋", text: "Drop into a prickle", note: "5 min to join" }, { label: "Tue", emoji: "🎯", text: "Set one small goal", note: "2 min" }] },
  FinishLineCards: { items: [{ title: "A finish line", program: "Program name", text: "One line about it.", durationLabel: "12 months", durationPercent: 100, buttonLabel: "See the program", href: "" }] },
  PlanPhases: { heading: "What the first weeks look like", items: [{ title: "Weeks 1 to 4", text: "What happens." }, { title: "Weeks 5 to 8", text: "What happens next." }] },
  JourneyMap: {
    stages: [{ name: "Idea", helps: "Membership", current: false }, { name: "Drafting", helps: "A program", current: false }, { name: "Revising", helps: "A course", current: true }],
    offer: { status: "open", statusLabel: "", title: "", text: "", buttonLabel: "", href: "" },
    compare: { label: "", href: "" },
  },
  ComingUp: { heading: "Coming up", items: [{ kind: "Retreat", title: "Name", when: "Dates and place", availability: "Spots left", status: "", linkLabel: "", href: "" }] },
} as const;

export const BLOCK_LABELS: Record<keyof typeof BLOCK_DEFAULTS, string> = {
  Section: "Section",
  Columns: "Columns",
  RichText: "Text",
  Heading: "Heading",
  Button: "Button",
  Image: "Image",
  Split: "Image and text",
  List: "List",
  Testimonials: "Testimonials",
  Faq: "FAQ",
  Countdown: "Countdown",
  CardGrid: "Card grid",
  LinkList: "Link list",
  Divider: "Divider",
  Spacer: "Spacer",
  Video: "Video",
  OptInForm: "Sign-up form",
  Hero: "Hero",
  Steps: "Steps",
  Stats: "Stats",
  CtaBanner: "Call-to-action banner",
  AnnouncementStrip: "Announcement strip",
  SchedulePanel: "Schedule panel",
  OutcomeNumbers: "Outcome numbers",
  FinisherCards: "Finisher cards",
  Timeline: "Timeline",
  WeekStrip: "Week strip",
  FinishLineCards: "Finish-line cards",
  PlanPhases: "Plan phases",
  JourneyMap: "Journey map",
  ComingUp: "Coming up",
};

const RENDERERS: Record<keyof typeof BLOCK_DEFAULTS, (props: never) => ReactNode> = {
  Section: Section as never,
  Columns: Columns as never,
  RichText: RichText as never,
  Heading: Heading as never,
  Button: Button as never,
  Image: Image as never,
  Split: Split as never,
  List: List as never,
  Testimonials: Testimonials as never,
  Faq: Faq as never,
  Countdown: CountdownBlock as never,
  CardGrid: CardGrid as never,
  LinkList: LinkList as never,
  Divider: Divider as never,
  Spacer: Spacer as never,
  Video: Video as never,
  OptInForm: OptInFormBlock as never,
  Hero: Hero as never,
  Steps: Steps as never,
  Stats: Stats as never,
  CtaBanner: CtaBanner as never,
  AnnouncementStrip: AnnouncementStrip as never,
  SchedulePanel: SchedulePanel as never,
  OutcomeNumbers: OutcomeNumbers as never,
  FinisherCards: FinisherCards as never,
  Timeline: Timeline as never,
  WeekStrip: WeekStrip as never,
  FinishLineCards: FinishLineCards as never,
  PlanPhases: PlanPhases as never,
  JourneyMap: JourneyMap as never,
  ComingUp: ComingUp as never,
};

/** The blocks that hold other blocks, and the names of their slots. Everything that walks a page finds nested blocks by their shape, so a new container only needs an entry here and in the editor's fields. */
export const SLOTS: Partial<Record<keyof typeof BLOCK_DEFAULTS, string[]>> = { Section: ["content"], Columns: ["col1", "col2", "col3"] };

function components(): Config["components"] {
  const out: Config["components"] = {};
  for (const name of Object.keys(BLOCK_DEFAULTS) as (keyof typeof BLOCK_DEFAULTS)[]) {
    out[name] = block({
      label: BLOCK_LABELS[name],
      defaultProps: { ...BLOCK_DEFAULTS[name], ...Object.fromEntries((SLOTS[name] ?? []).map((slot) => [slot, []])) },
      render: RENDERERS[name] as (props: unknown) => ReactNode,
      // A slot must be declared for Puck's Render to turn a container's stored blocks into the component it renders (the editor config declares it too).
      ...(SLOTS[name] ? { fields: Object.fromEntries(SLOTS[name].map((slot) => [slot, { type: "slot" }])) } : {}),
    });
  }
  return out;
}

/** What the public page renders with: blocks and frame, no fields. */
export const renderConfig = {
  components: components(),
  root: rootConfig as unknown as Config["root"],
  categories: {
    layout: { title: "Layout", components: ["Section", "Columns", "Split", "CardGrid", "Divider", "Spacer"] },
    ready_made: { title: "Ready-made", components: ["Hero", "Steps", "Stats", "CtaBanner"] },
    homepage: { title: "Homepage", components: ["AnnouncementStrip", "SchedulePanel", "OutcomeNumbers", "FinisherCards", "Timeline", "WeekStrip", "FinishLineCards", "PlanPhases", "JourneyMap", "ComingUp"] },
    content: { title: "Content", components: ["Heading", "RichText", "List", "Image", "Video", "Testimonials", "Faq", "Countdown"] },
    links: { title: "Links", components: ["Button", "LinkList", "OptInForm"] },
  },
} satisfies Config;
