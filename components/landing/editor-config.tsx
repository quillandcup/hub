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
      arrayFields: { imageAssetId: image("Picture"), alt: text("Describe the picture"), title: text("Title"), price: text("Price"), buttonLabel: text("Button label"), href: text("Button link") },
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
