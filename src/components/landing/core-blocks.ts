import { safeHref } from "@/lib/landing/data";
import { PADDING_DEFAULT_DESKTOP, PADDING_DEFAULT_MOBILE } from "@/lib/landing/layout";
import { definePageBlock, type PageBlockCategory, type PageBlockContribution, type PageBlockDefinition } from "./block-registry";
import {
  Accordion,
  AccordionItem,
  Button,
  ButtonRow,
  CardGrid,
  Columns,
  CountdownBlock,
  CtaBanner,
  Divider,
  Faq,
  FaqQuestion,
  GridCard,
  Heading,
  Hero,
  Image,
  LinkItem,
  LinkList,
  List,
  ListItem,
  OptInFormBlock,
  Pricing,
  PricingPlan,
  RichText,
  RowButton,
  Section,
  SocialIcons,
  SocialLink,
  Spacer,
  Split,
  Stat,
  Stats,
  Step,
  Steps,
  Testimonial,
  Testimonials,
  Video,
} from "./blocks";
import {
  FinishLineCard,
  FinishLineCards,
  FinisherCard,
  FinisherCards,
  JourneyMap,
  OutcomeNumber,
  OutcomeNumbers,
  PlanPhase,
  PlanPhases,
  Timeline,
  TimelineMoment,
  WeekDay,
  WeekStrip,
} from "./homepage-blocks";
import { ITEM_LIMITS } from "./item-limits";
import { SOCIAL_NETWORKS, socialNetworkOf } from "./social-networks";

/**
 * The blocks the pages code owns, registered through `definePageBlock` like any module's (block-registry.ts). A block is: a component
 * in blocks.tsx or homepage-blocks.tsx, its default props here, its fields in editor-config.tsx, and an entry in `coreBlocks` below that
 * names its palette group and, for a block with a list, the slot and the item it takes. See docs/product/LANDING_PAGES.md, "Adding a block",
 * and docs/architecture/PAGE_BLOCKS.md.
 */

/** A child block as it is stored in a parent's slot: `{ type, props }`. Puck gives it an id when the parent is added. */
const kid = (type: string, props: Record<string, unknown>) => ({ type, props: { ...props } });
const FINISHER_DEFAULT = { alt: "", name: "Name", kind: "Kind of book", dayOne: "Where she started", theEnd: "What she finished", linkLabel: "Read her story", href: "" };
const GRID_CARD_DEFAULT = { alt: "", icon: "", title: "A title", description: "A line about it.", price: "", buttonLabel: "", href: "" };
const PRICING_PLAN_DEFAULT = { name: "A plan", price: "$0", period: "one time", description: "", features: "A thing that is included\nAnother thing", badge: "", featured: false, buttonLabel: "Join now", href: "" };
const FINISH_LINE_DEFAULT = { title: "A finish line", program: "Program name", text: "One line about it.", durationLabel: "12 months", durationPercent: 100, buttonLabel: "See the program", href: "" };

export const CORE_DEFAULTS = {
  Section: { background: "none", overlay: "none", width: "wide", paddingDesktop: PADDING_DEFAULT_DESKTOP, paddingMobile: PADDING_DEFAULT_MOBILE, hideOnDesktop: false, hideOnMobile: false, align: "left", card: false, cardColor: "default", cardSoft: false, place: "center", textTone: "auto", fadeIn: false, fill: false },
  Columns: { count: "2", gap: "medium", verticalAlign: "top" },
  RichText: { html: "<p>Write something here.</p>", align: "left" },
  Heading: { text: "A heading", level: "h2", align: "center" },
  Button: { label: "Join us", href: "", look: "inherit", color: "plum", shape: "pill", align: "center", full: false },
  ButtonRow: { items: [kid("RowButton", { label: "Join us", href: "", look: "inherit", color: "plum", shape: "pill" }), kid("RowButton", { label: "Learn more", href: "", look: "outline", color: "plum", shape: "pill" })], align: "left", gap: "medium" },
  Image: { alt: "", decorative: false, size: "medium", rounded: true, align: "center", fit: "whole" },
  Split: { alt: "", decorative: false, imageSide: "left", html: "<h2>A heading</h2><p>Tell the story next to the picture.</p>" },
  List: { items: [kid("ListItem", { text: "First thing", icon: "✓" }), kid("ListItem", { text: "Second thing", icon: "✓" })], align: "left" },
  SocialIcons: { items: [kid("SocialLink", { network: "instagram", url: "" }), kid("SocialLink", { network: "youtube", url: "" })], align: "center", size: "medium", look: "colour" },
  Pricing: { items: [kid("PricingPlan", { ...PRICING_PLAN_DEFAULT, name: "First plan" }), kid("PricingPlan", { ...PRICING_PLAN_DEFAULT, name: "Second plan", badge: "Most popular", featured: true })] },
  Testimonials: { items: [kid("Testimonial", { quote: "What a difference this made.", name: "A member", detail: "Member since 2024" }), kid("Testimonial", { quote: "I finally finished my draft.", name: "Another member", detail: "" })] },
  Accordion: { items: [kid("AccordionItem", { title: "A title", text: "What opens under it.", open: false }), kid("AccordionItem", { title: "Another title", text: "What opens under that one.", open: false })] },
  Faq: { items: [kid("FaqQuestion", { question: "A question?", answer: "The answer." }), kid("FaqQuestion", { question: "Another question?", answer: "Another answer." })] },
  Countdown: { targetAt: "", heading: "Starts in", whenExpired: "message", expiredMessage: "It has started." },
  CardGrid: { columns: "3", items: [kid("GridCard", GRID_CARD_DEFAULT), kid("GridCard", GRID_CARD_DEFAULT), kid("GridCard", GRID_CARD_DEFAULT)] },
  LinkList: { items: [kid("LinkItem", { label: "A link", href: "", look: "inherit", color: "plum" }), kid("LinkItem", { label: "Another link", href: "", look: "inherit", color: "plum" })] },
  Divider: { look: "short" },
  Spacer: { size: "medium" },
  Video: { url: "", title: "" },
  Hero: { headline: "A headline that says what you offer", level: "h1", subhead: "One or two lines that say who it is for and why it helps.", primary: { label: "Join us", href: "" }, secondary: { label: "", href: "" }, alt: "", decorative: false, imageMode: "background", overlay: "dark", background: "plum", align: "center", padding: "large" },
  Steps: { heading: "How it works", items: [kid("Step", { title: "Sign up", text: "Tell us a little about you." }), kid("Step", { title: "Join in", text: "Come to your first session." }), kid("Step", { title: "Keep going", text: "Write a little each day." })] },
  Stats: { items: [kid("Stat", { value: "1,000", label: "words written a day" }), kid("Stat", { value: "24/7", label: "company" }), kid("Stat", { value: "3", label: "sessions a week" })] },
  CtaBanner: { heading: "Ready to start?", text: "", label: "Join us", href: "", background: "plum", align: "center" },
  OptInForm: { kajabiFormId: "", instagramField: "none", buttonLabel: "Sign me up", reassurance: "No spam. Unsubscribe any time.", successMessage: "Thank you! Please check your email.", href: "", look: "inherit", color: "plum", shape: "pill" },
  // Homepage blocks (src/components/landing/homepage-blocks.tsx): typed by hand, or live ("source"; docs/product/LANDING_PAGES.md, "Live data"). The ones about events are the events integration's (src/modules/events/page-blocks).
  OutcomeNumbers: {
    padding: "medium",
    showLiveNote: true,
    items: [
      kid("OutcomeNumber", { source: "manual", stat: "hours_30d", value: "50+", label: "books published by members", note: "" }),
      kid("OutcomeNumber", { source: "manual", stat: "hours_30d", value: "100s", label: "of Finishers", note: "" }),
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
  RowButton: { label: "Learn more", href: "", look: "outline", color: "plum", shape: "pill" },
  ListItem: { text: "New item", icon: "✓" },
  Testimonial: { quote: "", name: "", detail: "" },
  AccordionItem: { title: "A title", text: "", open: false },
  FaqQuestion: { question: "A question?", answer: "" },
  GridCard: { ...GRID_CARD_DEFAULT, title: "New card" },
  LinkItem: { label: "A link", href: "", look: "inherit", color: "plum" },
  OutcomeNumber: { source: "manual", stat: "hours_30d", value: "0", label: "", note: "" },
  PricingPlan: PRICING_PLAN_DEFAULT,
  SocialLink: { network: "instagram", url: "" },
  JourneyMap: {
    stages: [
      { name: "Idea", helps: "Membership", current: false, note: "", link: { label: "", href: "" }, offers: [{ status: "open", statusLabel: "", title: "Membership", text: "", buttonLabel: "", href: "" }] },
      { name: "Drafting", helps: "A program", current: false, note: "", link: { label: "", href: "" }, offers: [{ status: "open", statusLabel: "", title: "A program", text: "", buttonLabel: "", href: "" }] },
      { name: "Revising", helps: "A course", current: true, note: "", link: { label: "", href: "" }, offers: [{ status: "open", statusLabel: "", title: "A course", text: "", buttonLabel: "", href: "" }] },
    ],
    compare: { label: "", href: "" },
  },
} as const;


const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");

/** A question with no answer is drawn, but left out of what search engines are told (they need an answer), so say so. */
const faqCheck: NonNullable<PageBlockDefinition["publishCheck"]> = (props, { str: text, rows, warn }) => {
  const asked = rows(props.items).map((i) => (i.props ?? {}) as Record<string, unknown>);
  const unanswered = asked.filter((i) => text(i.question) && !text(i.answer)).length;
  if (unanswered > 0) warn("FAQ", `${unanswered === 1 ? "A question has" : `${unanswered} questions have`} no answer, so ${unanswered === 1 ? "it is" : "they are"} left out of what search engines are told about this FAQ.`);
};

/** More than one featured plan defeats the point of featuring one. */
const pricingCheck: NonNullable<PageBlockDefinition["publishCheck"]> = (props, { rows, warn }) => {
  const featured = rows(props.items).filter((i) => ((i.props ?? {}) as Record<string, unknown>).featured === true).length;
  if (featured > 1) warn("Pricing", `${featured} plans are marked featured; feature one, so it stands out.`);
};

/** A plan's name is a heading (an h3, under the section's), and its button needs a link like any other. The words by the plan's place are in `what`. */
const planCheck: NonNullable<PageBlockDefinition["publishCheck"]> = (props, { str: text, heading, checkButton, warn }) => {
  const name = text(props.name);
  if (name) heading(3, name);
  checkButton("Pricing", props.buttonLabel, props.href, name ? `The button of the "${name}" plan` : "A plan's button");
  if (!text(props.buttonLabel) && text(props.href)) warn("Pricing", `${name ? `The "${name}" plan has` : "A plan has"} a link but no button label, so the link is not shown.`);
};

/** A link with an address that can't be used (a script, a bare email address with no mailto:) is an error, like a button with no link. A link with no address at all draws nothing, which the generic empty-list check already warns about. */
const socialLinkCheck: NonNullable<PageBlockDefinition["publishCheck"]> = (props, { str: text, error }) => {
  const url = text(props.url);
  if (url && !safeHref(url)) error("Social icons", `The ${SOCIAL_NETWORKS[socialNetworkOf(props.network)]} link has an address that can't be used. Use https://, or mailto: for an email address.`);
};

type CoreType = keyof typeof CORE_DEFAULTS;
const core = (type: CoreType, label: string, category: PageBlockCategory, order: number, render: PageBlockDefinition["render"], more: Partial<PageBlockDefinition> = {}) =>
  definePageBlock({ type, label, category, order, defaults: CORE_DEFAULTS[type], render, ...more });
/** A block whose `items` slot takes blocks of one type. */
const holds = (item: string) => ({ items: { allow: [item] } });

/** What the pages code itself registers, through the same `definePageBlock` a module uses. Every type here is stored in page JSON: never rename one. */
export const coreBlocks: PageBlockContribution = {
  id: "pages",
  blocks: [
    // Layout
    core("Section", "Section", "layout", 10, Section, { slots: { content: {} } }),
    core("Columns", "Columns", "layout", 20, Columns, { slots: { col1: {}, col2: {}, col3: {} } }),
    core("Split", "Image and text", "layout", 30, Split),
    core("CardGrid", "Card grid", "layout", 40, CardGrid, { slots: holds("GridCard"), itemRule: { block: "Card grid", noun: "card", plural: "cards", item: "GridCard", key: "title" } }),
    core("Divider", "Divider", "layout", 50, Divider),
    core("Spacer", "Spacer", "layout", 60, Spacer),
    // Ready-made
    core("Hero", "Hero", "ready_made", 10, Hero),
    core("Steps", "Steps", "ready_made", 20, Steps, { slots: holds("Step"), itemLimit: ITEM_LIMITS.Steps, itemRule: { block: "Steps", noun: "step", plural: "steps", item: "Step", key: "title" } }),
    core("Stats", "Stats", "ready_made", 30, Stats, { slots: holds("Stat"), itemLimit: ITEM_LIMITS.Stats, itemRule: { block: "Stats", noun: "figure", plural: "figures", item: "Stat", key: "value" } }),
    core("CtaBanner", "Call-to-action banner", "ready_made", 40, CtaBanner),
    core("Pricing", "Pricing", "ready_made", 50, Pricing, {
      slots: holds("PricingPlan"),
      itemLimit: ITEM_LIMITS.Pricing,
      itemRule: { block: "Pricing", noun: "plan", plural: "plans", item: "PricingPlan", key: "name" },
      publishCheck: pricingCheck,
    }),
    // Homepage (the blocks about events are the events integration's)
    // A figure that is live shows with no typed value.
    core("OutcomeNumbers", "Outcome numbers", "homepage", 30, OutcomeNumbers, {
      slots: holds("OutcomeNumber"),
      itemLimit: ITEM_LIMITS.OutcomeNumbers,
      itemRule: { block: "Outcome numbers", noun: "figure", plural: "figures", item: "OutcomeNumber", key: "value", shown: (i) => Boolean(str(i.value)) || (i.source === "live" && Boolean(str(i.stat))) },
    }),
    core("FinisherCards", "Finisher cards", "homepage", 40, FinisherCards, { slots: holds("FinisherCard"), itemLimit: ITEM_LIMITS.FinisherCards, itemRule: { block: "Finisher cards", noun: "Finisher", plural: "Finishers", item: "FinisherCard", key: "name" } }),
    core("Timeline", "Timeline", "homepage", 50, Timeline, { slots: holds("TimelineMoment"), itemLimit: ITEM_LIMITS.Timeline, itemRule: { block: "Timeline", noun: "moment", plural: "moments", item: "TimelineMoment", key: "title" } }),
    core("WeekStrip", "Week strip", "homepage", 60, WeekStrip, { slots: holds("WeekDay"), itemLimit: ITEM_LIMITS.WeekStrip, itemRule: { block: "Week strip", noun: "day", plural: "days", item: "WeekDay", key: "label" } }),
    core("FinishLineCards", "Finish-line cards", "homepage", 70, FinishLineCards, { slots: holds("FinishLineCard"), itemLimit: ITEM_LIMITS.FinishLineCards, itemRule: { block: "Finish-line cards", noun: "finish line", plural: "finish lines", item: "FinishLineCard", key: "title" } }),
    core("PlanPhases", "Plan phases", "homepage", 80, PlanPhases, { slots: holds("PlanPhase"), itemLimit: ITEM_LIMITS.PlanPhases, itemRule: { block: "Plan phases", noun: "phase", plural: "phases", item: "PlanPhase", key: "title" } }),
    core("JourneyMap", "Journey map", "homepage", 90, JourneyMap),
    // Content
    core("Heading", "Heading", "content", 10, Heading),
    core("RichText", "Text", "content", 20, RichText),
    core("List", "List", "content", 30, List, { slots: holds("ListItem"), itemRule: { block: "List", noun: "item", plural: "items", item: "ListItem", key: "text" } }),
    core("Image", "Image", "content", 40, Image),
    core("Video", "Video", "content", 50, Video),
    core("Testimonials", "Testimonials", "content", 60, Testimonials, { slots: holds("Testimonial"), itemRule: { block: "Testimonials", noun: "testimonial", plural: "testimonials", item: "Testimonial", key: "quote" } }),
    core("Accordion", "Accordion", "content", 70, Accordion, { slots: holds("AccordionItem"), itemRule: { block: "Accordion", noun: "item", plural: "items", item: "AccordionItem", key: "title" } }),
    core("Faq", "FAQ", "content", 75, Faq, { slots: holds("FaqQuestion"), itemRule: { block: "FAQ", noun: "question", plural: "questions", item: "FaqQuestion", key: "question" }, publishCheck: faqCheck }),
    core("Countdown", "Countdown", "content", 80, CountdownBlock),
    // Links
    core("Button", "Button", "links", 10, Button),
    core("ButtonRow", "Buttons", "links", 20, ButtonRow, { slots: holds("RowButton"), itemLimit: ITEM_LIMITS.ButtonRow, itemRule: { block: "Buttons", noun: "button", plural: "buttons", item: "RowButton", key: "label" } }),
    core("LinkList", "Link list", "links", 30, LinkList, { slots: holds("LinkItem"), itemRule: { block: "Link list", noun: "link", plural: "links", item: "LinkItem", key: "label" } }),
    core("OptInForm", "Sign-up form", "links", 40, OptInFormBlock),
    core("SocialIcons", "Social icons", "links", 50, SocialIcons, {
      slots: holds("SocialLink"),
      itemLimit: ITEM_LIMITS.SocialIcons,
      itemRule: { block: "Social icons", noun: "link", plural: "links", item: "SocialLink", key: "url" },
    }),
    // Parts of a block: the items of the blocks above, each its own block, dropped into its parent's `items` slot.
    core("Step", "Step", "parts", 10, Step),
    core("Stat", "Figure", "parts", 20, Stat),
    core("FinisherCard", "Finisher card", "parts", 30, FinisherCard),
    core("TimelineMoment", "Timeline moment", "parts", 40, TimelineMoment),
    core("WeekDay", "Week day", "parts", 50, WeekDay),
    core("FinishLineCard", "Finish-line card", "parts", 60, FinishLineCard),
    core("PlanPhase", "Plan phase", "parts", 70, PlanPhase),
    core("RowButton", "Row button", "parts", 80, RowButton),
    core("ListItem", "List item", "parts", 90, ListItem),
    core("Testimonial", "Testimonial", "parts", 100, Testimonial),
    core("AccordionItem", "Accordion item", "parts", 110, AccordionItem),
    core("FaqQuestion", "Question", "parts", 115, FaqQuestion),
    core("GridCard", "Card", "parts", 120, GridCard),
    core("LinkItem", "Link", "parts", 130, LinkItem),
    core("PricingPlan", "Plan", "parts", 160, PricingPlan, { publishCheck: planCheck }),
    core("SocialLink", "Social link", "parts", 170, SocialLink, { publishCheck: socialLinkCheck }),
    core("OutcomeNumber", "Outcome number", "parts", 150, OutcomeNumber),
  ],
};
