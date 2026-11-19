"use client";

import type { Config, Field, Fields } from "@puckeditor/core";
import { ImageField, RichTextField, ZonedDateTimeField } from "./fields";
import { renderConfig } from "./config";
import { BACKGROUND_OPTIONS, PADDING_OPTIONS, WIDTH_OPTIONS } from "./theme";

/**
 * The editor's config: the blocks of config.tsx plus the fields that edit each one. Fields live here, and not with the
 * blocks, because they pull in the editor (TipTap, the media picker), which the public page must not ship.
 */

const text = (label: string): Field => ({ type: "text", label });
const area = (label: string): Field => ({ type: "textarea", label });
const select = (label: string, options: { label: string; value: string }[]): Field => ({ type: "select", label, options });
const toggle = (label: string): Field => ({
  type: "radio",
  label,
  options: [
    { label: "Yes", value: true },
    { label: "No", value: false },
  ],
});
const opts = (...values: string[]) => values.map((v) => ({ label: v[0].toUpperCase() + v.slice(1), value: v }));

const image = (label: string): Field => ({
  type: "custom",
  label,
  render: ({ value, onChange }) => <ImageField value={value as string | undefined} onChange={onChange} />,
});
const richText = (label: string): Field => ({
  type: "custom",
  label,
  render: ({ value, onChange }) => <RichTextField label={label} value={(value as string) ?? ""} onChange={onChange} />,
});
const dateTime = (label: string): Field => ({
  type: "custom",
  label,
  render: ({ value, onChange }) => <ZonedDateTimeField label={label} value={(value as string) ?? ""} onChange={onChange} />,
});

const link = (label: string): Field => ({ type: "object", label, objectFields: { label: text("Button label"), href: text("Link (https://, or a path on this site)") } });

const LOOK = select("Style", opts("solid", "outline"));
const COLOR = select("Colour", opts("plum", "light", "brown"));

const FIELDS: Record<string, Fields> = {
  Section: {
    background: select("Background colour", BACKGROUND_OPTIONS),
    backgroundImageAssetId: image("Background picture"),
    overlay: select("Shade over the picture", [
      { label: "None", value: "none" },
      { label: "Dark (light text)", value: "dark" },
      { label: "Light (dark text)", value: "light" },
    ]),
    width: select("Width of the content", WIDTH_OPTIONS),
    padding: select("Space above and below", PADDING_OPTIONS),
    align: select("Text alignment", opts("left", "center")),
    card: toggle("Put the content on a white card"),
    fadeIn: toggle("Fade in as it appears"),
    content: { type: "slot" },
  },
  Columns: {
    count: select("Columns", [{ label: "Two", value: "2" }, { label: "Three", value: "3" }]),
    gap: select("Space between the columns", opts("small", "medium", "large")),
    verticalAlign: select("Line up the columns", [{ label: "At the top", value: "top" }, { label: "In the middle", value: "center" }]),
    col1: { type: "slot" },
    col2: { type: "slot" },
    col3: { type: "slot" },
  },
  RichText: { html: richText("Text"), align: select("Alignment", opts("left", "center")) },
  Heading: { text: text("Heading"), level: select("Level", [{ label: "Page title (h1)", value: "h1" }, { label: "Section heading (h2)", value: "h2" }, { label: "Subheading (h3)", value: "h3" }]), align: select("Alignment", opts("left", "center", "right")) },
  Button: { label: text("Label"), href: text("Link (https://, or a path on this site)"), look: LOOK, color: COLOR, shape: select("Shape", [{ label: "Pill", value: "pill" }, { label: "Rectangle", value: "rect" }]), align: select("Alignment", opts("left", "center", "right")), full: toggle("Full width") },
  Image: { imageAssetId: image("Picture"), alt: text("Describe the picture (for screen readers)"), decorative: toggle("Decoration only, no description needed"), size: select("Size", opts("small", "medium", "full")), rounded: toggle("Rounded corners"), align: select("Alignment", opts("left", "center", "right")) },
  Split: { imageAssetId: image("Picture"), alt: text("Describe the picture (for screen readers)"), decorative: toggle("Decoration only, no description needed"), imageSide: select("Picture on", opts("left", "right")), html: richText("Text") },
  List: {
    items: { type: "array", label: "Items", arrayFields: { text: text("Text"), icon: text("Marker (an emoji; a check mark if empty)") }, defaultItemProps: { text: "New item", icon: "✓" }, getItemSummary: (i) => i.text || "Item" },
    align: select("Alignment", opts("left", "center")),
  },
  Testimonials: {
    items: { type: "array", label: "Testimonials", arrayFields: { quote: area("Quote"), name: text("Name"), detail: text("Detail (for example, how long they have been a member)") }, defaultItemProps: { quote: "", name: "", detail: "" }, getItemSummary: (i) => i.name || i.quote?.slice(0, 30) || "Testimonial" },
  },
  Faq: {
    items: { type: "array", label: "Questions", arrayFields: { question: text("Question"), answer: area("Answer") }, defaultItemProps: { question: "A question?", answer: "" }, getItemSummary: (i) => i.question || "Question" },
  },
  Countdown: { targetAt: dateTime("Counts down to"), heading: text("Heading above the clock"), whenExpired: select("When it reaches zero", [{ label: "Show a message", value: "message" }, { label: "Hide it", value: "hide" }, { label: "Keep showing zeros", value: "zeros" }]), expiredMessage: text("Message") },
  CardGrid: {
    columns: select("Most columns", [{ label: "2", value: "2" }, { label: "3", value: "3" }, { label: "4", value: "4" }]),
    items: {
      type: "array",
      label: "Cards",
      arrayFields: { imageAssetId: image("Picture"), alt: text("Describe the picture"), icon: text("Icon (an emoji)"), title: text("Title"), description: area("Short description"), price: text("Price"), buttonLabel: text("Button label"), href: text("Button link") },
      defaultItemProps: { alt: "", title: "New card", price: "", buttonLabel: "Buy now", href: "" },
      getItemSummary: (i) => i.title || "Card",
    },
  },
  LinkList: {
    items: { type: "array", label: "Links", arrayFields: { label: text("Label"), href: text("Link") }, defaultItemProps: { label: "A link", href: "" }, getItemSummary: (i) => i.label || "Link" },
    look: LOOK,
    color: COLOR,
  },
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
    items: { type: "array", label: "Steps (2 to 5)", max: 5, arrayFields: { title: text("Title"), text: area("Short text") }, defaultItemProps: { title: "New step", text: "" }, getItemSummary: (i) => i.title || "Step" },
  },
  Stats: {
    items: { type: "array", label: "Figures (2 to 4, typed in by hand)", max: 4, arrayFields: { value: text("Figure (for example 1,000 or 24/7)"), label: text("What it counts") }, defaultItemProps: { value: "0", label: "" }, getItemSummary: (i) => i.value || "Figure" },
  },
  CtaBanner: {
    heading: text("Heading"),
    text: area("Line under the heading (optional)"),
    label: text("Button label"),
    href: text("Button link (https://, or a path on this site)"),
    background: select("Background colour", BACKGROUND_OPTIONS.filter((o) => o.value !== "none")),
    align: select("Text alignment", opts("left", "center")),
  },
  AnnouncementStrip: {
    text: text("Line of news"),
    buttonLabel: text("Button label"),
    href: text("Button link (https://, or a path on this site)"),
    tone: select("Colour", [{ label: "Gold", value: "gold" }, { label: "Plum", value: "plum" }, { label: "Charcoal", value: "charcoal" }]),
  },
  SchedulePanel: {
    title: text("Panel title"),
    zoneLabel: text("Time zone note (for example, the zone the times are in)"),
    rows: {
      type: "array",
      label: "Sessions (typed by hand, up to 6)",
      max: 6,
      arrayFields: {
        time: text("Time"),
        title: text("Session name"),
        status: text("Status text (for example, Live, In 42 min)"),
        state: select("Status look", [{ label: "Live now", value: "live" }, { label: "Starting soon", value: "soon" }, { label: "Open", value: "open" }]),
        host: text("Line about the host (optional)"),
      },
      defaultItemProps: { time: "", title: "New session", status: "", state: "open", host: "" },
      getItemSummary: (i) => i.title || "Session",
    },
  },
  OutcomeNumbers: {
    padding: select("Space above and below", PADDING_OPTIONS),
    items: { type: "array", label: "Figures (2 to 4, typed in by hand)", max: 4, arrayFields: { value: text("Figure (for example 50+)"), label: text("What it counts"), note: text("Small note (optional, for example live)") }, defaultItemProps: { value: "0", label: "", note: "" }, getItemSummary: (i) => i.value || "Figure" },
  },
  FinisherCards: {
    items: {
      type: "array",
      label: "Finishers (up to 6)",
      max: 6,
      arrayFields: {
        imageAssetId: image("Photo"),
        alt: text("Describe the photo (for screen readers)"),
        name: text("Name"),
        kind: text("Kind of book"),
        dayOne: text("Day 1 line (where she started)"),
        theEnd: text("THE END line (what she finished)"),
        linkLabel: text("Link label (for example, Read her story)"),
        href: text("Link (https://, or a path on this site)"),
      },
      defaultItemProps: { alt: "", name: "Name", kind: "", dayOne: "", theEnd: "", linkLabel: "", href: "" },
      getItemSummary: (i) => i.name || "Finisher",
    },
    more: { type: "object", label: "Link under the cards (optional)", objectFields: { label: text("Link label (for example, See every Finisher)"), href: text("Link (https://, or a path on this site)") } },
  },
  Timeline: {
    heading: text("Heading above the timeline (optional)"),
    intro: area("Line under the heading (optional)"),
    items: { type: "array", label: "Moments", arrayFields: { when: text("When (for example, 8:00 am)"), title: text("Title"), text: area("Short text") }, defaultItemProps: { when: "", title: "New moment", text: "" }, getItemSummary: (i) => i.title || "Moment" },
    closing: text("Closing line (optional)"),
  },
  WeekStrip: {
    subtitle: text("Line above the days (optional)"),
    items: { type: "array", label: "Days (up to 7)", max: 7, arrayFields: { label: text("Day (for example, Mon)"), emoji: text("Emoji"), text: text("What happens"), note: text("Small note") }, defaultItemProps: { label: "Day", emoji: "", text: "", note: "" }, getItemSummary: (i) => i.label || "Day" },
  },
  FinishLineCards: {
    items: {
      type: "array",
      label: "Finish lines (2 to 3)",
      max: 3,
      arrayFields: {
        title: text("Title"),
        program: text("Program name"),
        text: area("One line about it"),
        durationLabel: text("Length label (for example, 12 months)"),
        durationPercent: { type: "number", label: "How full the length bar is (0 to 100)", min: 0, max: 100 },
        buttonLabel: text("Button label"),
        href: text("Button link (https://, or a path on this site)"),
      },
      defaultItemProps: { title: "New finish line", program: "", text: "", durationLabel: "", durationPercent: 100, buttonLabel: "", href: "" },
      getItemSummary: (i) => i.title || "Finish line",
    },
  },
  PlanPhases: {
    heading: text("Heading above the phases (optional)"),
    items: { type: "array", label: "Phases (2 to 4, light to deeper)", max: 4, arrayFields: { title: text("Title (for example, Weeks 1 to 4)"), text: area("What happens") }, defaultItemProps: { title: "New phase", text: "" }, getItemSummary: (i) => i.title || "Phase" },
  },
  JourneyMap: {
    stages: { type: "array", label: "Stages, in order", max: 7, arrayFields: { name: text("Stage"), helps: text("What helps here"), current: toggle("Mark as the current stage") }, defaultItemProps: { name: "New stage", helps: "", current: false }, getItemSummary: (i) => i.name || "Stage" },
    offer: {
      type: "object",
      label: "Highlighted offer under the stages (optional)",
      objectFields: {
        status: select("Status", [{ label: "Open", value: "open" }, { label: "Waitlist", value: "waitlist" }, { label: "Coming soon", value: "soon" }, { label: "Dates announced", value: "dates" }]),
        statusLabel: text("Status text, if not the usual one (optional)"),
        title: text("Title"),
        text: area("Short text"),
        buttonLabel: text("Button label"),
        href: text("Button link (https://, or a path on this site)"),
      },
    },
    compare: { type: "object", label: "Compare link (optional)", objectFields: { label: text("Link label (for example, Compare all programs)"), href: text("Link (https://, or a path on this site)") } },
  },
  ComingUp: {
    heading: text("Heading above the cards (optional)"),
    items: {
      type: "array",
      label: "Cards (up to 4)",
      max: 4,
      arrayFields: {
        kind: text("Kind (for example, Retreat)"),
        title: text("Title"),
        when: text("Dates and place"),
        availability: text("Availability (for example, 6 spots left)"),
        status: select("Status pill (optional)", [{ label: "None", value: "" }, { label: "Open", value: "open" }, { label: "Waitlist", value: "waitlist" }, { label: "Coming soon", value: "soon" }, { label: "Dates announced", value: "dates" }]),
        linkLabel: text("Link label (optional)"),
        href: text("Link (https://, or a path on this site)"),
      },
      defaultItemProps: { kind: "", title: "New card", when: "", availability: "", status: "", linkLabel: "", href: "" },
      getItemSummary: (i) => i.title || "Card",
    },
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
};

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

/** The config the editor opens with. */
export const editorConfig: Config = {
  ...renderConfig,
  components: Object.fromEntries(Object.entries(renderConfig.components).map(([name, c]) => [name, { ...c, fields: FIELDS[name] }])),
  root: { ...renderConfig.root, fields: ROOT_FIELDS },
};
