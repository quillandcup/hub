import type { ComponentConfig, Config } from "@puckeditor/core";
import type { ComponentType, ReactNode } from "react";
import { safeHref } from "@/lib/landing/data";
import { PADDING_DEFAULT_DESKTOP, PADDING_DEFAULT_MOBILE } from "@/lib/landing/layout";
import {
  Button,
  ButtonRow,
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
  Stat,
  Stats,
  Step,
  Steps,
  Testimonials,
  Video,
} from "./blocks";
import {
  AnnouncementStrip,
  ComingUp,
  FinishLineCard,
  FinishLineCards,
  FinisherCard,
  FinisherCards,
  JourneyMap,
  OutcomeNumbers,
  PlanPhase,
  PlanPhases,
  SchedulePanel,
  Timeline,
  TimelineMoment,
  WeekDay,
  WeekStrip,
} from "./homepage-blocks";
import { EMPTY_SITE_TEMPLATE, type SiteTemplate } from "@/lib/landing/site-template";
import { resolveStyle, styleClasses } from "@/lib/landing/style";
import { DesignToolsOverlay } from "./design-tools";
import { SiteFooterView, SiteHeaderView } from "./site-frame";
import { pageImage, spanClasses } from "./theme";

/**
 * The block set and the page frame, with no editor-only parts: the public page renders `data` through this (on the
 * server), and the editor builds its own config from it by adding each block's fields (editor-config.tsx). A new
 * block is: a component in blocks.tsx, an entry here with its default props, and its fields in editor-config.tsx.
 * See docs/product/LANDING_PAGES.md, "Adding a block".
 */

// Puck types each component's props from its config; our blocks are plain components, so they are registered loosely.
const block = <P,>(config: { label: string; defaultProps: P; render: (props: P) => ReactNode; inline?: boolean; fields?: Record<string, { type: string }> }) => config as unknown as ComponentConfig;

export type RootProps = {
  showHeader?: boolean;
  logoAssetId?: string;
  logoAlt?: string;
  logoHref?: string;
  navLinks?: { label: string; href: string }[];
  showFooter?: boolean;
  footerText?: string;
  footerLinks?: { label: string; href: string }[];
  /** This page's own style tokens (docs/product/LANDING_PAGES.md, "Settings"); absent means the page follows the site's. */
  styleOverride?: unknown;
  /** This page's own favicon (a media asset id; an empty string means none); absent means the page follows the site's. Read by the page's head, not drawn. */
  faviconOverrideAssetId?: string;
};

const LINK_ROW = "px-2 py-1 text-sm underline-offset-4 hover:underline";

/**
 * How a page is framed. A landing page draws its own header and footer from its root fields. A website page draws the site
 * template's instead (docs/product/LANDING_PAGES.md, "Site template"): `site` is the published copy on the public page and the draft
 * in the editor, where `editing` shows each region with a note that it is shared and a link to where it is edited.
 */
export type FrameContext = { pageType: "website" | "landing"; site: SiteTemplate | null; editing?: boolean };
export const DESIGN_HREF = "/admin/pages/design";

/** A fixed region of the editor's canvas that belongs to the whole site: not draggable, not selectable, with where to change it. */
function SiteRegion({ name, empty, children }: { name: "header" | "footer"; empty: boolean; children: ReactNode }) {
  return (
    <div data-site-region={name} className="border-y border-dashed border-accent">
      <div className="pointer-events-none">{empty ? <p className="px-4 py-3 text-center text-sm text-ink-muted">The site {name} is off or empty.</p> : children}</div>
      <p className="bg-tile px-4 py-1 text-center text-xs text-ink-muted">
        Shared by every website page.{" "}
        <a href={DESIGN_HREF} target="_blank" rel="noopener" className="font-medium text-accent-ink underline">
          Edit the {name} in Design
        </a>
      </p>
    </div>
  );
}

/** The frame around every page: an optional header (logo and links), the blocks, an optional footer. Where `@container` lives, so blocks respond to the room they have. */
export function PageFrame({ children, frame, ...root }: RootProps & { children?: ReactNode; frame?: FrameContext }) {
  const logo = pageImage(root.logoAssetId, "event_card");
  const nav = (root.navLinks ?? []).filter((l) => l.label && safeHref(l.href));
  const footerLinks = (root.footerLinks ?? []).filter((l) => l.label && safeHref(l.href));
  // The page's look: the site's style tokens, then this page's own where it has them (lib/landing/style.ts). The same for the editor's canvas and a visitor.
  const frameClasses = `@container relative min-h-screen bg-page text-ink ${styleClasses(resolveStyle(frame?.site?.style, root.styleOverride))}`;
  const tools = frame?.editing ? <DesignToolsOverlay /> : null;
  if (frame?.pageType === "website") {
    const site = frame.site ?? EMPTY_SITE_TEMPLATE;
    const header = SiteHeaderView({ header: site.header });
    const footer = SiteFooterView({ footer: site.footer });
    return (
      <div data-lp-frame className={frameClasses}>
        {frame.editing ? (
          <SiteRegion name="header" empty={header === null}>
            {header}
          </SiteRegion>
        ) : (
          header
        )}
        <main>{children}</main>
        {frame.editing ? (
          <SiteRegion name="footer" empty={footer === null}>
            {footer}
          </SiteRegion>
        ) : (
          footer
        )}
        {tools}
      </div>
    );
  }
  return (
    // The page colour (`page`: the brand canvas, or slate in dark mode), light or dark with the theme (the app's dark mode, or the visitor's system setting); never `bg-background`, which is the app's grey.
    // Light bands (`landing-light`) stay light in dark mode.
    <div data-lp-frame className={frameClasses}>
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
      {tools}
    </div>
  );
}

const rootDefaults = { showHeader: false, showFooter: false, navLinks: [], footerLinks: [], footerText: "" };
const rootConfig = { defaultProps: rootDefaults, render: PageFrame };

/** The page's root, framed for its kind of page. Make it once per render (or memoize it): a new component each time remounts the page. */
export function rootConfigFor(frame: FrameContext): Config["root"] {
  return { defaultProps: rootDefaults, render: (props: RootProps & { children?: ReactNode }) => PageFrame({ ...props, frame }) } as unknown as Config["root"];
}

/** A child block as it is stored in a parent's slot: `{ type, props }`. Puck gives it an id when the parent is added. */
const kid = (type: string, props: Record<string, unknown>) => ({ type, props: { ...props } });
const FINISHER_DEFAULT = { alt: "", name: "Name", kind: "Kind of book", dayOne: "Where she started", theEnd: "What she finished", linkLabel: "Read her story", href: "" };
const FINISH_LINE_DEFAULT = { title: "A finish line", program: "Program name", text: "One line about it.", durationLabel: "12 months", durationPercent: 100, buttonLabel: "See the program", href: "" };

export const BLOCK_DEFAULTS = {
  Section: { background: "none", overlay: "none", width: "wide", paddingDesktop: PADDING_DEFAULT_DESKTOP, paddingMobile: PADDING_DEFAULT_MOBILE, hideOnDesktop: false, hideOnMobile: false, align: "left", card: false, fadeIn: false },
  Columns: { count: "2", gap: "medium", verticalAlign: "top" },
  RichText: { html: "<p>Write something here.</p>", align: "left" },
  Heading: { text: "A heading", level: "h2", align: "center" },
  Button: { label: "Join us", href: "", look: "inherit", color: "plum", shape: "pill", align: "center", full: false },
  ButtonRow: { items: [{ label: "Join us", href: "", look: "inherit", color: "plum", shape: "pill" }, { label: "Learn more", href: "", look: "outline", color: "plum", shape: "pill" }], align: "left", gap: "medium" },
  Image: { alt: "", decorative: false, size: "medium", rounded: true, align: "center" },
  Split: { alt: "", decorative: false, imageSide: "left", html: "<h2>A heading</h2><p>Tell the story next to the picture.</p>" },
  List: { items: [{ text: "First thing", icon: "✓" }, { text: "Second thing", icon: "✓" }], align: "left" },
  Testimonials: { items: [{ quote: "What a difference this made.", name: "A member", detail: "Member since 2024" }] },
  Faq: { items: [{ question: "A question?", answer: "The answer." }] },
  Countdown: { targetAt: "", heading: "Starts in", whenExpired: "message", expiredMessage: "It has started." },
  CardGrid: { columns: "3", items: [{ alt: "", title: "A title", price: "$20", buttonLabel: "Buy now", href: "" }] },
  LinkList: { items: [{ label: "A link", href: "" }], look: "inherit", color: "plum" },
  Divider: { look: "short" },
  Spacer: { size: "medium" },
  Video: { url: "", title: "" },
  Hero: { headline: "A headline that says what you offer", level: "h1", subhead: "One or two lines that say who it is for and why it helps.", primary: { label: "Join us", href: "" }, secondary: { label: "", href: "" }, alt: "", decorative: false, imageMode: "background", overlay: "dark", background: "plum", align: "center", padding: "large" },
  Steps: { heading: "How it works", items: [kid("Step", { title: "Sign up", text: "Tell us a little about you." }), kid("Step", { title: "Join in", text: "Come to your first session." }), kid("Step", { title: "Keep going", text: "Write a little each day." })] },
  Stats: { items: [kid("Stat", { value: "1,000", label: "words written a day" }), kid("Stat", { value: "24/7", label: "company" }), kid("Stat", { value: "3", label: "sessions a week" })] },
  CtaBanner: { heading: "Ready to start?", text: "", label: "Join us", href: "", background: "plum", align: "center" },
  OptInForm: { kajabiFormId: "", instagramField: "none", buttonLabel: "Sign me up", reassurance: "No spam. Unsubscribe any time.", successMessage: "Thank you! Please check your email.", href: "", look: "inherit", color: "plum", shape: "pill" },
  // Homepage blocks (components/landing/homepage-blocks.tsx): typed by hand, or live ("source"; docs/product/LANDING_PAGES.md, "Live data"). A block dropped on a page now starts live where its point is to be live (strip, schedule, coming up), with the typed values as the fallback; a block saved without `source` stays typed.
  AnnouncementStrip: { text: "Your next prickle starts soon", buttonLabel: "Drop in", href: "", tone: "gold", source: "live", whenNone: "hide" },
  SchedulePanel: {
    title: "Writing right now",
    zoneLabel: "",
    source: "live",
    hoursAhead: 24,
    maxRows: 5,
    hostStyle: "none",
    experiencedHostText: "An experienced host, sure to make you feel at home",
    openLabel: "",
    rowNote: "",
    footer: "",
    emptyText: "No sessions are coming up just yet. Check back soon.",
    rows: [
      { time: "9:00 am", title: "Morning pages", status: "Live", state: "live", host: "" },
      { time: "10:00 am", title: "Focus hour", status: "In 42 min", state: "soon", host: "" },
      { time: "12:30 pm", title: "Lunch hour", status: "Camera optional", state: "open", host: "" },
    ],
  },
  OutcomeNumbers: {
    padding: "medium",
    showLiveNote: true,
    items: [
      { source: "manual", stat: "hours_30d", value: "50+", label: "books published by members", note: "" },
      { source: "manual", stat: "hours_30d", value: "100s", label: "of Finishers", note: "" },
    ],
  },
  FinisherCards: { items: [kid("FinisherCard", FINISHER_DEFAULT), kid("FinisherCard", FINISHER_DEFAULT), kid("FinisherCard", FINISHER_DEFAULT)], more: { label: "", href: "" } },
  Timeline: {
    heading: "",
    intro: "",
    items: [kid("TimelineMoment", { when: "8:00 am", title: "Morning pages", text: "What happens, in a line or two." }), kid("TimelineMoment", { when: "Noon", title: "Chat", text: "What happens next." })],
    closing: "",
  },
  WeekStrip: {
    subtitle: "",
    items: [
      kid("WeekDay", { label: "Mon", emoji: "👋", text: "Drop into a prickle", note: "5 min to join" }),
      kid("WeekDay", { label: "Tue", emoji: "🎯", text: "Set one small goal", note: "2 min" }),
      kid("WeekDay", { label: "Wed", emoji: "✍️", text: "Write and log progress", note: "" }),
    ],
  },
  FinishLineCards: { items: [kid("FinishLineCard", FINISH_LINE_DEFAULT), kid("FinishLineCard", FINISH_LINE_DEFAULT)] },
  PlanPhases: { heading: "What the first weeks look like", items: [kid("PlanPhase", { title: "Weeks 1 to 4", text: "What happens." }), kid("PlanPhase", { title: "Weeks 5 to 8", text: "What happens next." })] },
  // The items of the blocks above: each its own block, with its own fields, dropped into its parent's `items` slot (SLOT_ALLOW).
  Step: { title: "New step", text: "" },
  Stat: { value: "0", label: "" },
  FinisherCard: FINISHER_DEFAULT,
  TimelineMoment: { when: "", title: "New moment", text: "" },
  WeekDay: { label: "Day", emoji: "", text: "", note: "" },
  FinishLineCard: FINISH_LINE_DEFAULT,
  PlanPhase: { title: "New phase", text: "" },
  JourneyMap: {
    stages: [
      { name: "Idea", helps: "Membership", current: false, note: "", link: { label: "", href: "" }, offers: [{ status: "open", statusLabel: "", title: "Membership", text: "", buttonLabel: "", href: "" }] },
      { name: "Drafting", helps: "A program", current: false, note: "", link: { label: "", href: "" }, offers: [{ status: "open", statusLabel: "", title: "A program", text: "", buttonLabel: "", href: "" }] },
      { name: "Revising", helps: "A course", current: true, note: "", link: { label: "", href: "" }, offers: [{ status: "open", statusLabel: "", title: "A course", text: "", buttonLabel: "", href: "" }] },
    ],
    compare: { label: "", href: "" },
  },
  ComingUp: {
    heading: "Coming up",
    style: "cards",
    source: "live",
    kinds: ["in_person_retreat", "virtual_retreat", "workshop"],
    max: 4,
    more: { label: "", href: "" },
    waitlist: { label: "Join the waitlist", href: "" },
    items: [{ kind: "Retreat", title: "Name", when: "Dates and place", availability: "Spots left", status: "", linkLabel: "", href: "" }],
  },
} as const;

export const BLOCK_LABELS: Record<keyof typeof BLOCK_DEFAULTS, string> = {
  Section: "Section",
  Columns: "Columns",
  RichText: "Text",
  Heading: "Heading",
  Button: "Button",
  ButtonRow: "Buttons",
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
  Step: "Step",
  Stat: "Figure",
  FinisherCard: "Finisher card",
  TimelineMoment: "Timeline moment",
  WeekDay: "Week day",
  FinishLineCard: "Finish-line card",
  PlanPhase: "Plan phase",
};

const RENDERERS: Record<keyof typeof BLOCK_DEFAULTS, (props: never) => ReactNode> = {
  Section: Section as never,
  Columns: Columns as never,
  RichText: RichText as never,
  Heading: Heading as never,
  Button: Button as never,
  ButtonRow: ButtonRow as never,
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
  Step: Step as never,
  Stat: Stat as never,
  FinisherCard: FinisherCard as never,
  TimelineMoment: TimelineMoment as never,
  WeekDay: WeekDay as never,
  FinishLineCard: FinishLineCard as never,
  PlanPhase: PlanPhase as never,
};

type BlockName = keyof typeof BLOCK_DEFAULTS;

/**
 * The blocks that hold a list of items as a slot of child blocks, with the type each slot takes. The items are blocks of
 * their own (a Finisher card, a week's day), so they drag on the canvas and are edited by clicking them (docs/product/LANDING_PAGES.md,
 * "Blocks with items"). The editor limits the slot to these types (`allow`) and keeps them out of Sections and Columns
 * (`disallow`); the JSON import drops anything else.
 */
export const SLOT_ALLOW: Partial<Record<BlockName, Record<string, BlockName[]>>> = {
  Steps: { items: ["Step"] },
  Stats: { items: ["Stat"] },
  FinisherCards: { items: ["FinisherCard"] },
  Timeline: { items: ["TimelineMoment"] },
  WeekStrip: { items: ["WeekDay"] },
  FinishLineCards: { items: ["FinishLineCard"] },
  PlanPhases: { items: ["PlanPhase"] },
};

/** The item block types: they are in the palette under "Parts of a block" and only make sense inside their parent. */
export const ITEM_BLOCKS: BlockName[] = [...new Set(Object.values(SLOT_ALLOW).flatMap((slots) => Object.values(slots ?? {}).flat()))];

/** The blocks that hold other blocks, and the names of their slots. Everything that walks a page finds nested blocks by their shape, so a new container only needs an entry here and in the editor's fields. */
export const SLOTS: Partial<Record<BlockName, string[]>> = {
  Section: ["content"],
  Columns: ["col1", "col2", "col3"],
  ...Object.fromEntries(Object.entries(SLOT_ALLOW).map(([name, slots]) => [name, Object.keys(slots ?? {})])),
};

type BoxProps = { puck?: { dragRef?: ((el: Element | null) => void) | null; isEditing?: boolean }; span?: unknown; spanMobile?: unknown } & Record<string, unknown>;

/**
 * Every block is drawn inside one box that carries its width on the Section's 12-column grid (`span`, `spanMobile`;
 * lib/landing/layout.ts). The box is the grid item on the public page and in the editor alike: the config marks blocks
 * `inline`, so Puck puts no wrapper of its own around them and takes its drag handle from this box (`puck.dragRef`).
 * Outside a Section there is no grid and the classes do nothing.
 */
function boxed(name: keyof typeof BLOCK_DEFAULTS) {
  const Block = RENDERERS[name] as unknown as ComponentType<Record<string, unknown>>;
  return function BlockBox({ puck, span, spanMobile, ...props }: BoxProps) {
    return (
      <div ref={puck?.dragRef ?? undefined} className={`min-w-0 ${spanClasses(span, spanMobile)}`}>
        <Block {...props} {...(SLOTS[name] ? { editing: Boolean(puck?.isEditing) } : {})} />
      </div>
    );
  };
}

/**
 * An item block (a Finisher card, a week's day) is its own root element, a list item of its parent's slot, and has no width
 * box: it is not on a Section's grid, its parent lays it out. It takes the drag handle itself (`dragRef`), and is told
 * whether the page is being edited, so an empty one stays visible there and draws nothing on the public page.
 */
function itemBoxed(name: keyof typeof BLOCK_DEFAULTS) {
  const Item = RENDERERS[name] as unknown as ComponentType<Record<string, unknown>>;
  return function ItemBox({ puck, ...props }: BoxProps) {
    return <Item {...props} dragRef={puck?.dragRef ?? undefined} editing={Boolean(puck?.isEditing)} />;
  };
}

function components(): Config["components"] {
  const out: Config["components"] = {};
  for (const name of Object.keys(BLOCK_DEFAULTS) as (keyof typeof BLOCK_DEFAULTS)[]) {
    out[name] = block({
      label: BLOCK_LABELS[name],
      // A slot starts empty unless the block's defaults give it items (a freshly added Steps block starts with three steps).
      defaultProps: { ...Object.fromEntries((SLOTS[name] ?? []).map((slot) => [slot, []])), ...BLOCK_DEFAULTS[name] },
      render: (ITEM_BLOCKS.includes(name) ? itemBoxed(name) : boxed(name)) as (props: unknown) => ReactNode,
      inline: true,
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
    // The items of the blocks that hold a list of them; dragged into that block's list on the canvas (or added by duplicating one).
    parts: { title: "Parts of a block", components: ITEM_BLOCKS },
    homepage: { title: "Homepage", components: ["AnnouncementStrip", "SchedulePanel", "OutcomeNumbers", "FinisherCards", "Timeline", "WeekStrip", "FinishLineCards", "PlanPhases", "JourneyMap", "ComingUp"] },
    content: { title: "Content", components: ["Heading", "RichText", "List", "Image", "Video", "Testimonials", "Faq", "Countdown"] },
    links: { title: "Links", components: ["Button", "ButtonRow", "LinkList", "OptInForm"] },
  },
} satisfies Config;

/** The render config for a page framed as `frame` says (a website page's shared header and footer, or a landing page's own). */
export function renderConfigFor(frame: FrameContext): Config {
  return { ...renderConfig, root: rootConfigFor(frame) };
}
