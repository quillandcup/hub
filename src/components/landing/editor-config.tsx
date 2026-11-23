"use client";

import type { Config, Field, Fields } from "@puckeditor/core";
import { installedPageBlockEditors } from "@/modules/editor";
import { LIVE_STAT_OPTIONS } from "@/lib/landing/live-stats";
import type { PageBlockRegistry } from "./block-registry";
import { withStandIns } from "./block-placeholder";
import { buildRenderConfig, pageBlocks, renderConfig, rootConfigFor, type FrameContext } from "./config";
import { SOCIAL_NETWORK_OPTIONS } from "./social-networks";
import { createEditorKit, type EditorKit, type PageBlockEditorContribution } from "./editor-kit";
import { PaddingField, SpanField } from "./layout-fields";
import { BACKGROUND_OPTIONS, PADDING_OPTIONS, WIDTH_OPTIONS } from "./theme";

/**
 * The editor's config: the blocks of config.tsx plus the fields that edit each one. Fields live here, and not with the
 * blocks, because they pull in the editor (TipTap, the media picker), which the public page must not ship.
 */

// The field helpers are the editor kit's (editor-kit.tsx), shared with the fields modules contribute; the ones below are the pages code's own.
const { text, area, select, toggle, opts, image, richText, dateTime, link } = createEditorKit(pageBlocks);

const padding = (label: string, size: "desktop" | "mobile"): Field => ({
  type: "custom",
  label,
  render: ({ value, onChange }) => <PaddingField label={label} size={size} value={value} onChange={onChange} />,
});
const span = (label: string): Field => ({
  type: "custom",
  label,
  render: ({ value, onChange }) => <SpanField label={label} value={value} onChange={onChange} />,
});

/** What a block gets when it sits in a Section: its width on the Section's 12-column grid, for each size (src/lib/landing/layout.ts). */
const SPAN_FIELDS: Fields = { span: span("Width on desktop"), spanMobile: span("Width on mobile") };

/** "Same as the site" takes the site style guide's button style (Design, or a page's own style); solid and outline are this button's own choice. */
const LOOK = select("Style", [{ label: "Same as the site", value: "inherit" }, { label: "Solid", value: "solid" }, { label: "Outline", value: "outline" }]);
const COLOR = select("Colour", opts("plum", "light", "brown"));

/** The fields of the blocks the pages code owns, by type (a module's are in its own editor contribution). */
const coreFields = ({ source: SOURCE, contentSlot, itemsSlot }: EditorKit): Record<string, Fields> => ({
  Section: {
    background: select("Background colour", BACKGROUND_OPTIONS),
    backgroundImageAssetId: image("Background picture"),
    overlay: select("Shade over the picture", [
      { label: "None", value: "none" },
      { label: "Dark (light text)", value: "dark" },
      { label: "Light (dark text)", value: "light" },
    ]),
    width: select("Width of the content", WIDTH_OPTIONS),
    align: select("Text alignment", opts("left", "center")),
    card: toggle("Put the content on a white card"),
    fadeIn: toggle("Fade in as it appears"),
    paddingDesktop: padding("Space inside on desktop", "desktop"),
    paddingMobile: padding("Space inside on mobile", "mobile"),
    hideOnDesktop: toggle("Hide on desktop"),
    hideOnMobile: toggle("Hide on mobile"),
    content: contentSlot(),
  },
  Columns: {
    count: select("Columns", [{ label: "Two", value: "2" }, { label: "Three", value: "3" }]),
    gap: select("Space between the columns", opts("small", "medium", "large")),
    verticalAlign: select("Line up the columns", [{ label: "At the top", value: "top" }, { label: "In the middle", value: "center" }]),
    col1: contentSlot(),
    col2: contentSlot(),
    col3: contentSlot(),
  },
  RichText: { html: richText("Text"), align: select("Alignment", opts("left", "center")) },
  Heading: { text: text("Heading"), level: select("Level", [{ label: "Page title (h1)", value: "h1" }, { label: "Section heading (h2)", value: "h2" }, { label: "Subheading (h3)", value: "h3" }]), align: select("Alignment", opts("left", "center", "right")) },
  Button: { label: text("Label"), href: text("Link (https://, or a path on this site)"), look: LOOK, color: COLOR, shape: select("Shape", [{ label: "Pill", value: "pill" }, { label: "Rectangle", value: "rect" }]), align: select("Alignment", opts("left", "center", "right")), full: toggle("Full width") },
  ButtonRow: {
    items: itemsSlot("ButtonRow", "Buttons (1 to 3)"),
    align: select("Alignment", opts("left", "center")),
    gap: select("Space between the buttons", opts("small", "medium")),
  },
  RowButton: { label: text("Label"), href: text("Link (https://, or a path on this site)"), look: LOOK, color: COLOR, shape: select("Shape", [{ label: "Pill", value: "pill" }, { label: "Rectangle", value: "rect" }]) },
  Image: { imageAssetId: image("Picture"), alt: text("Describe the picture (for screen readers)"), decorative: toggle("Decoration only, no description needed"), size: select("Size", opts("small", "medium", "full")), rounded: toggle("Rounded corners"), align: select("Alignment", opts("left", "center", "right")) },
  Split: { imageAssetId: image("Picture"), alt: text("Describe the picture (for screen readers)"), decorative: toggle("Decoration only, no description needed"), imageSide: select("Picture on", opts("left", "right")), html: richText("Text") },
  List: {
    items: itemsSlot("List", "Items"),
    align: select("Alignment", opts("left", "center")),
  },
  ListItem: { text: text("Text"), icon: text("Marker (an emoji; a check mark if empty)") },
  SocialIcons: {
    items: itemsSlot("SocialIcons", "Links (up to 8)"),
    align: select("Alignment", opts("left", "center", "right")),
    size: select("Size", opts("small", "medium", "large")),
  },
  SocialLink: { network: select("Network", SOCIAL_NETWORK_OPTIONS), url: text("Link (https://, or mailto:you@example.com for Email)") },
  Pricing: {
    items: itemsSlot("Pricing", "Plans (1 to 3)"),
  },
  PricingPlan: {
    name: text("Name of the plan"),
    price: text("Price, as you want it shown (for example $97)"),
    period: text("Billing period or note, shown after the price (for example per month)"),
    description: area("Short description"),
    features: area("What is included, one line each"),
    badge: text("Badge (for example Most popular)"),
    featured: toggle("Feature this plan (heavier border, said aloud to screen readers)"),
    buttonLabel: text("Button label"),
    href: text("Button link (https://, or a path on this site)"),
  },
  Testimonials: {
    items: itemsSlot("Testimonials", "Testimonials"),
  },
  Testimonial: { quote: area("Quote"), name: text("Name"), detail: text("Detail (for example, how long they have been a member)") },
  Accordion: {
    items: itemsSlot("Accordion", "Items"),
  },
  AccordionItem: { title: text("Title"), text: area("Text that opens under it"), open: toggle("Start open") },
  Faq: {
    items: itemsSlot("Faq", "Questions"),
  },
  FaqQuestion: { question: text("Question"), answer: area("Answer") },
  Countdown: { targetAt: dateTime("Counts down to"), heading: text("Heading above the clock"), whenExpired: select("When it reaches zero", [{ label: "Show a message", value: "message" }, { label: "Hide it", value: "hide" }, { label: "Keep showing zeros", value: "zeros" }]), expiredMessage: text("Message") },
  CardGrid: {
    columns: select("Most columns", [{ label: "2", value: "2" }, { label: "3", value: "3" }, { label: "4", value: "4" }]),
    items: itemsSlot("CardGrid", "Cards"),
  },
  GridCard: { imageAssetId: image("Picture"), alt: text("Describe the picture"), icon: text("Icon (an emoji)"), title: text("Title"), description: area("Short description"), price: text("Price"), buttonLabel: text("Button label"), href: text("Button link") },
  LinkList: {
    items: itemsSlot("LinkList", "Links"),
  },
  LinkItem: { label: text("Label"), href: text("Link"), look: LOOK, color: COLOR },
  Divider: { look: select("Style", [{ label: "Short line", value: "short" }, { label: "Full line", value: "line" }]) },
  Spacer: { size: select("Size", opts("small", "medium", "large")) },
  Video: { url: text("YouTube, Vimeo or Mux link"), title: text("Title (for screen readers)") },
  Hero: {
    headline: text("Headline"),
    level: select("Headline is", [{ label: "Page title (h1)", value: "h1" }, { label: "Section heading (h2), when the page has a title already", value: "h2" }]),
    subhead: area("Line under the headline"),
    primary: link("Main button"),
    secondary: link("Second button (optional)"),
    imageAssetId: image("Picture (optional)"),
    imageMode: select("Show the picture", [{ label: "Behind the words", value: "background" }, { label: "Beside the words", value: "side" }]),
    overlay: select("Shade over a picture behind the words", [
      { label: "None", value: "none" },
      { label: "Dark (light text)", value: "dark" },
      { label: "Light (dark text)", value: "light" },
    ]),
    alt: text("Describe the picture, when it is beside the words (for screen readers)"),
    decorative: toggle("Decoration only, no description needed"),
    background: select("Background colour", BACKGROUND_OPTIONS),
    align: select("Text alignment", opts("left", "center")),
    padding: select("Space above and below", PADDING_OPTIONS),
  },
  Steps: {
    heading: text("Heading above the steps (optional)"),
    items: itemsSlot("Steps", "Steps (2 to 5)"),
  },
  Stats: {
    items: itemsSlot("Stats", "Figures (2 to 4, typed in by hand)"),
  },
  Step: { title: text("Title"), text: area("Short text") },
  Stat: { value: text("Figure (for example 1,000 or 24/7)"), label: text("What it counts") },
  CtaBanner: {
    heading: text("Heading"),
    text: area("Line under the heading (optional)"),
    label: text("Button label"),
    href: text("Button link (https://, or a path on this site)"),
    background: select("Background colour", BACKGROUND_OPTIONS.filter((o) => o.value !== "none")),
    align: select("Text alignment", opts("left", "center")),
  },
  OutcomeNumbers: {
    padding: select("Space above and below", PADDING_OPTIONS),
    showLiveNote: toggle("Show a small \"live\" note beside live figures"),
    items: itemsSlot("OutcomeNumbers", "Figures (2 to 4)"),
  },
  OutcomeNumber: {
    source: SOURCE,
    stat: select("Live figure (used when it comes from the Hub)", LIVE_STAT_OPTIONS),
    value: text("Typed figure (for example 50+; also what shows if the live one can't be read)"),
    label: text("What it counts (empty: the live figure's own words)"),
    note: text("Small note (optional)"),
  },
  FinisherCards: {
    items: itemsSlot("FinisherCards", "Finishers (up to 6)"),
    more: { type: "object", label: "Link under the cards (optional)", objectFields: { label: text("Link label (for example, See every Finisher)"), href: text("Link (https://, or a path on this site)") } },
  },
  FinisherCard: {
    imageAssetId: image("Photo"),
    alt: text("Describe the photo (for screen readers)"),
    name: text("Name"),
    kind: text("Kind of book"),
    dayOne: text("Day 1 line (where she started)"),
    theEnd: text("THE END line (what she finished)"),
    linkLabel: text("Link label (for example, Read her story)"),
    href: text("Link (https://, or a path on this site)"),
  },
  Timeline: {
    heading: text("Heading above the timeline (optional)"),
    intro: area("Line under the heading (optional)"),
    items: itemsSlot("Timeline", "Moments"),
    closing: text("Closing line (optional)"),
  },
  TimelineMoment: { when: text("When (for example, 8:00 am)"), title: text("Title"), text: area("Short text") },
  WeekStrip: {
    subtitle: text("Line above the days (optional)"),
    items: itemsSlot("WeekStrip", "Days (up to 7)"),
  },
  WeekDay: { label: text("Day (for example, Mon)"), emoji: text("Emoji"), text: text("What happens"), note: text("Small note") },
  FinishLineCards: {
    items: itemsSlot("FinishLineCards", "Finish lines (2 to 3)"),
  },
  FinishLineCard: {
    title: text("Title"),
    program: text("Program name"),
    text: area("One line about it"),
    durationLabel: text("Length label (for example, 12 months)"),
    durationPercent: { type: "number", label: "How full the length bar is (0 to 100)", min: 0, max: 100 },
    buttonLabel: text("Button label"),
    href: text("Button link (https://, or a path on this site)"),
  },
  PlanPhases: {
    heading: text("Heading above the phases (optional)"),
    items: itemsSlot("PlanPhases", "Phases (2 to 4, light to deeper)"),
  },
  PlanPhase: { title: text("Title (for example, Weeks 1 to 4)"), text: area("What happens") },
  JourneyMap: {
    stages: {
      type: "array",
      label: "Stages, in order (up to 6)",
      max: 6,
      arrayFields: {
        name: text("Stage"),
        helps: text("What helps here (the line under the stage name)"),
        current: toggle("Show this stage first (the one chosen when the page opens)"),
        note: text("Line shown when this stage has no offers (optional)"),
        link: { type: "object", label: "Link under that line (optional)", objectFields: { label: text("Link label"), href: text("Link (https://, or a path on this site)") } },
        offers: {
          type: "array",
          label: "Offers shown when this stage is chosen (up to 4)",
          max: 4,
          arrayFields: {
            status: select("Status", [{ label: "Open", value: "open" }, { label: "Waitlist", value: "waitlist" }, { label: "Coming soon", value: "soon" }, { label: "Dates announced", value: "dates" }]),
            statusLabel: text("Status text, if not the usual one (optional)"),
            title: text("Title"),
            text: area("Short text"),
            buttonLabel: text("Button label"),
            href: text("Button link (https://, or a path on this site)"),
            featured: toggle("Lead with this one (shown large; the others become a short list of links). If none is chosen, the first leads"),
          },
          defaultItemProps: { status: "open", statusLabel: "", title: "New offer", text: "", buttonLabel: "", href: "", featured: false },
          getItemSummary: (i) => i.title || "Offer",
        },
      },
      defaultItemProps: { name: "New stage", helps: "", current: false, note: "", link: { label: "", href: "" }, offers: [] },
      getItemSummary: (i) => i.name || "Stage",
    },
    compare: { type: "object", label: "Compare link (optional)", objectFields: { label: text("Link label (for example, Compare all programs)"), href: text("Link (https://, or a path on this site)") } },
  },
  OptInForm: {
    kajabiFormId: text("Kajabi form (its id: Kajabi, Marketing, Forms; the sign-up goes into that form)"),
    instagramField: select("Ask for an Instagram handle, and keep it in", [
      { label: "Don't ask", value: "none" },
      { label: "Kajabi custom field 1", value: "custom_1" },
      { label: "Kajabi custom field 2", value: "custom_2" },
      { label: "Kajabi custom field 3", value: "custom_3" },
    ]),
    buttonLabel: text("Button label"),
    reassurance: text("Line under the button (for example, no spam)"),
    successMessage: text("Message after signing up"),
    href: text("Or go to this page after signing up (https://, or a path on this site)"),
    look: LOOK,
    color: COLOR,
    shape: select("Shape", [{ label: "Pill", value: "pill" }, { label: "Rectangle", value: "rect" }]),
  },
});

const ROOT_FIELDS: Fields = {
  showHeader: toggle("Show a header"),
  logoAssetId: image("Logo"),
  logoAlt: text("Logo description"),
  logoHref: text("Where the logo links to"),
  navLinks: { type: "array", label: "Header links", arrayFields: { label: text("Label"), href: text("Link") }, defaultItemProps: { label: "Link", href: "" }, getItemSummary: (i) => i.label || "Link" },
  showFooter: toggle("Show a footer"),
  footerText: text("Footer text (for example, a copyright line)"),
  footerLinks: { type: "array", label: "Footer links", arrayFields: { label: text("Label"), href: text("Link") }, defaultItemProps: { label: "Link", href: "" }, getItemSummary: (i) => i.label || "Link" },
};

/** The pages code's own fields, then each installed module's, by block type. A field set for a type the registry lacks is a mistake and throws. */
function collectFields(registry: PageBlockRegistry, contributions: readonly PageBlockEditorContribution[]): Record<string, Fields> {
  const kit = createEditorKit(registry);
  const out: Record<string, Fields> = {};
  for (const contribution of [{ id: "pages", fields: coreFields }, ...contributions]) {
    for (const [type, fields] of Object.entries(contribution.fields(kit))) {
      if (!registry.has(type)) throw new Error(`The "${contribution.id}" editor fields are for the block "${type}", which no contribution registers.`);
      if (Object.hasOwn(out, type)) throw new Error(`The block "${type}" has editor fields from two contributions ("${contribution.id}" is the second).`);
      out[type] = fields;
    }
  }
  return out;
}

/**
 * The editor's config for a registry: its render config with the fields that edit each block. A block with no fields is a mistake the
 * config tests catch. Built from a registry so a composition without a module (the tests build one) is the same code path as the installed one.
 */
export function buildEditorConfig(registry: PageBlockRegistry, contributions: readonly PageBlockEditorContribution[] = installedPageBlockEditors): Config {
  const base = registry === pageBlocks ? renderConfig : buildRenderConfig(registry);
  const fields = collectFields(registry, contributions);
  return {
    ...base,
    components: Object.fromEntries(
      Object.entries(base.components).map(([name, c]) => [
        name,
        {
          ...c,
          fields: fields[name],
          // The width fields appear only for a block that is inside a Section; elsewhere there is no grid to take columns from.
          resolveFields: (_data: unknown, { fields, parent }: { fields: Fields; parent: { type: string } | null }) => (parent?.type === "Section" ? { ...fields, ...SPAN_FIELDS } : fields),
        },
      ]),
    ),
    root: { ...base.root, fields: ROOT_FIELDS },
  };
}

/** The config the editor opens with. */
export const editorConfig: Config = buildEditorConfig(pageBlocks);

/**
 * The editor's config for a page, framed as the page is (the site's style under it, and for a website page the site's header and
 * footer). A landing page edits its own header and footer in the root fields; a website page shows the site's as fixed regions
 * (edited in Design, not here), so it has no header or footer fields of its own. Style and favicon are in the Settings panel.
 * A block of the page that no contribution registers (its module is not installed) gets a stand-in that keeps it as stored
 * (block-placeholder.tsx), so opening and saving such a page loses nothing.
 */
export function editorConfigFor(frame: FrameContext, data?: unknown, config: Config = editorConfig, registry: PageBlockRegistry = pageBlocks): Config {
  return withStandIns({ ...config, root: { ...rootConfigFor(frame), fields: frame.pageType === "website" ? {} : ROOT_FIELDS } }, data, registry, true);
}
