import type { ReactNode } from "react";
import { parseEmbed, safeHref } from "@/lib/landing/data";
import { ITEM_LIMITS } from "./item-limits";
import Countdown, { type CountdownProps } from "./Countdown";
import OptInForm, { type OptInFormProps } from "./OptInForm";
import { sectionPadding } from "@/lib/landing/layout";
import { SocialMark } from "./social-marks";
import { SOCIAL_NETWORKS, socialNetworkOf } from "./social-networks";
import { background, BAND_SPACE, hideClass, pageImage, pick, PADDING, SECTION_SPACE, sectionVars, WIDTHS } from "./theme";

/**
 * The page builder's blocks as plain components: the same ones render in the editor's canvas and on the public page
 * (docs/product/LANDING_PAGES.md). No hooks and no browser APIs here (the countdown is its own client component), so the
 * public route renders them on the server. Layout inside the page uses container queries (`@container` is on the page
 * wrapper, see PageFrame) with the named sizes from config/tailwind.ts, so a block reflows with the room it has, in the
 * editor's phone preview as on a phone. Links go through `safeHref`; rich text arrives already cleaned.
 */

/** A slot as a block receives it: Puck's component, drawn where the blocks inside go (`as` makes its box a list, so each item is a list item). */
export type Slot = (props?: { className?: string; collisionAxis?: "dynamic" | "x" | "y"; as?: "ul" | "ol" | "dl" }) => ReactNode;

/**
 * What every item block (a Finisher card, a step, a day...) is given besides its own props: the editor's drag handle, which
 * the item attaches to its own root element (the config marks items `inline`, so Puck puts no wrapper around them), and
 * whether the page is being edited. On the public page `editing` is off, and an item with nothing in it draws nothing.
 */
export type ItemProps = { dragRef?: (el: Element | null) => void; editing?: boolean };

const CAP_CLASS: Record<number, string> = {
  3: "[&>:nth-child(n+4)]:hidden",
  4: "[&>:nth-child(n+5)]:hidden",
  5: "[&>:nth-child(n+6)]:hidden",
  6: "[&>:nth-child(n+7)]:hidden",
  7: "[&>:nth-child(n+8)]:hidden",
  8: "[&>:nth-child(n+9)]:hidden",
  12: "[&>:nth-child(n+13)]:hidden",
};

/**
 * The classes a block's list of items (its slot) gets on the public page: an empty list is not drawn, and items past the
 * most the block's layout is made for are hidden (the publish check says so). In the editor neither applies, so an empty
 * list stays a place to drop into and every item stays reachable.
 */
export const itemList = (max: number | null, editing?: boolean): string => (editing ? "" : `empty:hidden ${(max !== null && CAP_CLASS[max]) || ""}`);
const noImage = null;

/**
 * Put on every slot: it makes the slot a block formatting context, so the top margin of its first block (a Heading's
 * `my-3`) and the bottom margin of its last stay inside it instead of collapsing out. The public page looks the same
 * (the margin lands in the same place, inside the Section's padding); in the editor, Puck draws the slot's dashed
 * outline around its own box, so without this the first heading touches the outline.
 */
const SLOT_CLASS = "flow-root";

const PROSE =
  "prose max-w-none text-inherit prose-headings:font-display prose-headings:text-inherit prose-p:text-inherit prose-li:text-inherit prose-strong:text-inherit prose-a:text-inherit prose-blockquote:text-inherit prose-ol:text-inherit prose-ul:text-inherit";

export function RichHtml({ html, className = "" }: { html?: string; className?: string }) {
  if (!html) return null;
  // `html` is cleaned to an allowlist on save and again before a public render (src/lib/landing/sanitize.ts), never raw.
  return <div className={`${PROSE} ${className}`} dangerouslySetInnerHTML={{ __html: html }} />;
}

const ALIGN = { left: "text-left", center: "text-center", right: "text-right" } as const;
const alignClass = (a: unknown) => pick(ALIGN, a, "left");

// ---- Section -------------------------------------------------------------------------------------------------

const OVERLAY = { none: "", dark: "bg-black/55", light: "bg-white/70" } as const;

export type SectionProps = {
  background: string;
  backgroundImageAssetId?: string;
  overlay: "none" | "dark" | "light";
  width: string;
  /** Inner space in px, per size (src/lib/landing/layout.ts); a missing or invalid side takes the default. */
  paddingDesktop?: unknown;
  paddingMobile?: unknown;
  hideOnDesktop?: boolean;
  hideOnMobile?: boolean;
  align: "left" | "center";
  card: boolean;
  fadeIn: boolean;
  content: Slot;
  /** Set by the editor's canvas only: a hidden section is dimmed there instead of hidden. */
  editing?: boolean;
};

/** The slot of a Section is a 12-column grid: a block takes the columns its `span` says (the full width when unset). */
const SECTION_GRID = "grid grid-cols-12 gap-x-4 @split:gap-x-6";

/** A full-width band with a background colour or picture, and a 12-column grid of other blocks inside it. */
export function Section({ background: bg, backgroundImageAssetId, overlay, width, paddingDesktop, paddingMobile, hideOnDesktop, hideOnMobile, align, card, fadeIn, content: Content, editing }: SectionProps) {
  const theme = background(bg);
  const image = pageImage(backgroundImageAssetId, "event_hero");
  // Over a picture, readable text follows the overlay (the editor warns when there is none); without one, the colour's own.
  const text = image && overlay === "dark" ? "text-white" : image && overlay === "light" ? "text-ink" : theme.text;
  const scope = image ? (overlay === "light" ? "landing-light" : "") : theme.scope;
  const space = sectionPadding({ paddingDesktop, paddingMobile });
  return (
    <section
      className={`relative ${theme.bg} ${text} ${scope} ${SECTION_SPACE} ${hideClass(Boolean(hideOnDesktop), Boolean(hideOnMobile), Boolean(editing))} ${fadeIn ? "landing-fade-in" : ""}`}
      style={{ ...sectionVars(space.desktop, space.mobile), ...(image ? { backgroundImage: `url(${image})`, backgroundSize: "cover", backgroundPosition: "center" } : {}) }}
    >
      {image && overlay !== "none" && <div aria-hidden="true" className={`absolute inset-0 ${OVERLAY[overlay]}`} />}
      <div className={`relative mx-auto ${pick(WIDTHS, width, "wide").cls} ${alignClass(align === "center" ? "center" : "left")}`}>
        {card ? (
          <div className="rounded-xl bg-card p-6 text-ink shadow-lg @pair:p-10">
            <Content className={SECTION_GRID} collisionAxis="dynamic" />
          </div>
        ) : (
          <Content className={SECTION_GRID} collisionAxis="dynamic" />
        )}
      </div>
    </section>
  );
}

// ---- Columns -------------------------------------------------------------------------------------------------

export type ColumnsProps = { count: "2" | "3"; gap: "small" | "medium" | "large"; verticalAlign: "top" | "center"; col1: Slot; col2: Slot; col3: Slot };
const COLUMN_GAP = { small: "gap-4", medium: "gap-8", large: "gap-12" } as const;

/**
 * Two or three side-by-side areas, each holding other blocks. One column on a narrow container (mobile first), side by
 * side from `@split`. No background and no text colour of its own: it inherits the Section it sits in. Switching from
 * three columns to two keeps what was in the third (it is not shown, nor checked, until it is switched back).
 */
export function Columns({ count, gap, verticalAlign, col1: Col1, col2: Col2, col3: Col3 }: ColumnsProps) {
  const three = count === "3";
  return (
    <div className={`grid ${pick(COLUMN_GAP, gap, "medium")} ${three ? "@split:grid-cols-3" : "@split:grid-cols-2"} ${verticalAlign === "center" ? "@split:items-center" : "@split:items-start"}`}>
      <div className="min-w-0">
        <Col1 className={SLOT_CLASS} />
      </div>
      <div className="min-w-0">
        <Col2 className={SLOT_CLASS} />
      </div>
      {three && (
        <div className="min-w-0">
          <Col3 className={SLOT_CLASS} />
        </div>
      )}
    </div>
  );
}

// ---- Text ----------------------------------------------------------------------------------------------------

export type RichTextProps = { html: string; align: "left" | "center" };
export function RichText({ html, align }: RichTextProps) {
  return <RichHtml html={html} className={`py-2 ${alignClass(align)}`} />;
}

export type HeadingProps = { text: string; level: "h1" | "h2" | "h3"; align: "left" | "center" | "right" };
const HEADING_SIZE = { h1: "text-4xl @pair:text-5xl", h2: "text-3xl @pair:text-4xl", h3: "text-2xl @pair:text-3xl" } as const;
export function Heading({ text, level, align }: HeadingProps) {
  const Tag = level === "h1" || level === "h3" ? level : "h2";
  return text ? <Tag className={`my-3 font-display font-semibold leading-tight ${HEADING_SIZE[Tag]} ${alignClass(align)}`}>{text}</Tag> : null;
}

// ---- Button --------------------------------------------------------------------------------------------------

export type ButtonProps = { label: string; href: string; look: ButtonLook; color: "plum" | "light" | "brown"; shape: "pill" | "rect"; align: "left" | "center" | "right"; full: boolean };
const BUTTON_COLORS = {
  solid: { plum: "bg-plum-600 text-white hover:bg-plum-700", light: "bg-cream text-plum-900 hover:bg-white", brown: "bg-brown text-white hover:bg-brown-deep" },
  outline: { plum: "border-2 border-current text-accent-ink hover:bg-accent/10", light: "border-2 border-current text-cream hover:bg-white/10", brown: "border-2 border-current text-warm hover:bg-accent/10" },
} as const;
const JUSTIFY = { left: "text-left", center: "text-center", right: "text-right" } as const;

/** A button's look: its own solid or outline, or "inherit" (the default) to take the site's button style (`lp-btn-style-*`, src/lib/landing/style.ts). */
export type ButtonLook = "inherit" | "solid" | "outline";

/**
 * The classes of every button the builder draws. `lp-btn` is what the style guide's button size and corners act on, `lp-btn-primary`
 * marks a solid button in the primary colour (its fill and text colour), and `lp-btn-inherit` a button that takes the site's button
 * style: it is drawn solid, and the site's "outline" turns it into an outline (src/app/globals.css). A button that says "solid" or
 * "outline" keeps that look whatever the site says; anything else (an old or missing value) follows the site.
 */
export function buttonClasses(look: unknown, color: unknown, shape: unknown, full: boolean) {
  const l: ButtonLook = look === "outline" || look === "solid" ? look : "inherit";
  const c = color === "light" || color === "brown" ? color : "plum";
  const filled = l !== "outline";
  return `lp-btn lp-btn-c-${c} ${l === "inherit" ? "lp-btn-inherit" : ""} ${filled && c === "plum" ? "lp-btn-primary" : ""} inline-block ${full ? "w-full text-center" : ""} ${shape === "rect" ? "rounded-md" : "rounded-full"} px-6 py-3 text-base font-semibold no-underline transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 ${BUTTON_COLORS[filled ? "solid" : "outline"][c]}`;
}

export function Button({ label, href, look, color, shape, align, full }: ButtonProps) {
  const target = safeHref(href);
  if (!label) return null;
  return (
    <div className={`my-3 ${pick(JUSTIFY, align, "center")}`}>
      {target ? (
        <a href={target} className={buttonClasses(look, color, shape, full)}>
          {label}
        </a>
      ) : (
        // No (or an unsafe) link: shown disabled rather than as a button that goes nowhere.
        <span aria-disabled="true" className={`${buttonClasses(look, color, shape, full)} opacity-50`}>
          {label}
        </span>
      )}
    </div>
  );
}

// ---- ButtonRow -----------------------------------------------------------------------------------------------

export type ButtonRowProps = { items: Slot; align: "left" | "center"; gap: "small" | "medium"; editing?: boolean };
const ROW_GAP = { small: "gap-2", medium: "gap-3" } as const;

/** One to three buttons side by side (each a `RowButton` in the `items` slot), wrapping onto the next line when the container is too narrow. Built like Button: same classes, `safeHref`, disabled without a usable link. */
export function ButtonRow({ items: Items, align, gap, editing }: ButtonRowProps) {
  return <Items as="ul" collisionAxis="dynamic" className={`my-3 flex flex-wrap ${pick(ROW_GAP, gap, "medium")} ${align === "center" ? "justify-center" : "justify-start"} ${itemList(ITEM_LIMITS.ButtonRow, editing)}`} />;
}

export type RowButtonProps = { label: string; href: string; look: ButtonLook; color: "plum" | "light" | "brown"; shape: "pill" | "rect" } & ItemProps;

/** One button of a Buttons block. With no label it draws nothing on the public page; while editing it shows as a faded placeholder, so it can still be found and dragged. */
export function RowButton({ label, href, look, color, shape, dragRef, editing }: RowButtonProps) {
  if (!label && !editing) return null;
  const target = safeHref(href);
  const classes = buttonClasses(look, color, shape, false);
  return (
    <li ref={dragRef}>
      {target && label ? (
        <a href={target} className={classes}>
          {label}
        </a>
      ) : (
        // No (or an unsafe) link: shown disabled rather than as a button that goes nowhere.
        <span aria-disabled="true" className={`${classes} opacity-50`}>
          {label || "Button"}
        </span>
      )}
    </li>
  );
}

// ---- Image ---------------------------------------------------------------------------------------------------

export type ImageProps = { imageAssetId?: string; alt: string; decorative: boolean; size: "small" | "medium" | "full"; rounded: boolean; align: "left" | "center" | "right"; fit?: "whole" | "crop" };
const IMAGE_SIZE = { small: "max-w-xs", medium: "max-w-xl", full: "max-w-full" } as const;
const IMAGE_ALIGN = { left: "mr-auto", center: "mx-auto", right: "ml-auto" } as const;

/** The whole picture at its own shape by default (a logo or a wide banner must not lose its ends); `fit: "crop"` fills a 16:9 frame instead. */
export function Image({ imageAssetId, alt, decorative, size, rounded, align, fit }: ImageProps) {
  const crop = fit === "crop";
  const src = pageImage(imageAssetId, crop ? "event_hero" : "page_image");
  if (!src) return noImage;
  return (
    // eslint-disable-next-line @next/next/no-img-element -- served by the media route, already sized by its preset
    <img src={src} alt={decorative ? "" : alt} loading="lazy" className={`my-3 h-auto w-full ${crop ? "aspect-video object-cover" : ""} ${pick(IMAGE_SIZE, size, "medium")} ${pick(IMAGE_ALIGN, align, "center")} ${rounded ? "rounded-2xl" : ""}`} />
  );
}

// ---- Split: image and text -----------------------------------------------------------------------------------

export type SplitProps = { imageAssetId?: string; alt: string; decorative: boolean; imageSide: "left" | "right"; html: string };
/** Picture and words side by side once there is room (`@split`), stacked (picture first) below it; `imageSide` only matters side by side. */
export function Split({ imageAssetId, alt, decorative, imageSide, html }: SplitProps) {
  const src = pageImage(imageAssetId, "page_image");
  return (
    <div className="grid items-center gap-6 py-4 @split:grid-cols-2 @split:gap-10">
      {src && (
        // eslint-disable-next-line @next/next/no-img-element -- served by the media route, already sized by its preset
        <img src={src} alt={decorative ? "" : alt} loading="lazy" className={`h-auto w-full rounded-2xl ${imageSide === "right" ? "@split:order-2" : ""}`} />
      )}
      <RichHtml html={html} />
    </div>
  );
}

// ---- List ----------------------------------------------------------------------------------------------------

export type ListProps = { items: Slot; align: "left" | "center"; editing?: boolean };

/** A list of short points with a marker each, every point a `ListItem` in the `items` slot. */
export function List({ items: Items, align, editing }: ListProps) {
  return <Items as="ul" collisionAxis="y" className={`my-3 space-y-2 ${align === "center" ? "mx-auto w-fit" : ""} ${itemList(null, editing)}`} />;
}

export type ListItemProps = { text: string; icon: string } & ItemProps;

/** One point of a List: its marker (a check mark when none is set) and its words. */
export function ListItem({ text, icon, dragRef, editing }: ListItemProps) {
  if (!text && !editing) return null;
  return (
    <li ref={dragRef} className="flex gap-3">
      <span aria-hidden="true" className="shrink-0">
        {icon || "✓"}
      </span>
      <span>{text}</span>
    </li>
  );
}

// ---- Testimonials --------------------------------------------------------------------------------------------

export type TestimonialsProps = { items: Slot; editing?: boolean };

/** Quotes in two columns once there is room, each a `Testimonial` in the `items` slot. */
export function Testimonials({ items: Items, editing }: TestimonialsProps) {
  return <Items collisionAxis="dynamic" className={`grid gap-4 py-4 @cards:grid-cols-2 ${itemList(null, editing)}`} />;
}

export type TestimonialProps = { quote: string; name: string; detail: string } & ItemProps;

/** One quote with who said it. Nothing is drawn without the quote itself. */
export function Testimonial({ quote, name, detail, dragRef, editing }: TestimonialProps) {
  if (!quote && !editing) return null;
  return (
    <figure ref={dragRef} className="rounded-xl border-t-4 border-accent bg-tile p-5 text-ink shadow-sm">
      <blockquote className="whitespace-pre-line">“{quote}”</blockquote>
      {(name || detail) && (
        <figcaption className="mt-3 text-sm">
          <span className="font-semibold">{name}</span>
          {detail && <span className="block text-ink-muted">{detail}</span>}
        </figcaption>
      )}
    </figure>
  );
}

// ---- Accordion and FAQ ---------------------------------------------------------------------------------------

export type AccordionProps = { items: Slot; editing?: boolean };

const DISCLOSURE_LIST = "my-3 divide-y divide-current rounded-lg border border-current";

/** A ruled box of collapsible items, each an `AccordionItem` in the `items` slot. For anything that folds away; questions and answers are the FAQ. */
export function Accordion({ items: Items, editing }: AccordionProps) {
  return <Items collisionAxis="y" className={`${DISCLOSURE_LIST} ${itemList(null, editing)}`} />;
}

/** One title that opens to its text. Native disclosure elements: keyboard and screen reader support without script. `open` makes it start open. */
function Disclosure({ title, text, open, dragRef }: { title: string; text: string; open?: boolean; dragRef?: ItemProps["dragRef"] }) {
  return (
    <details ref={dragRef} open={open || undefined} className="group p-4">
      <summary className="cursor-pointer list-none font-semibold marker:hidden [&::-webkit-details-marker]:hidden">
        <span className="flex items-center justify-between gap-3">
          {title}
          <span aria-hidden="true" className="transition-transform group-open:rotate-45">
            +
          </span>
        </span>
      </summary>
      <div className="mt-2 space-y-2">
        {(text ?? "").split(/\n+/).filter(Boolean).map((line, j) => (
          <p key={j}>{line}</p>
        ))}
      </div>
    </details>
  );
}

export type AccordionItemProps = { title: string; text: string; open?: boolean } & ItemProps;

/** One item of an Accordion. Nothing is drawn without its title (the editor shows it). */
export function AccordionItem({ title, text, open, dragRef, editing }: AccordionItemProps) {
  if (!title && !editing) return null;
  return <Disclosure title={title} text={text} open={open} dragRef={dragRef} />;
}

export type FaqProps = { items: Slot; editing?: boolean };

/**
 * Questions and their answers, each a `FaqQuestion` in the `items` slot. It looks like an Accordion; what makes it the FAQ is that the
 * public page also tells search engines about the questions (`faqStructuredData`, src/lib/landing/faq-schema.ts, drawn by `LandingRender`).
 */
export function Faq({ items: Items, editing }: FaqProps) {
  return <Items collisionAxis="y" className={`${DISCLOSURE_LIST} ${itemList(null, editing)}`} />;
}

export type FaqQuestionProps = { question: string; answer: string } & ItemProps;

/** One question and its answer. Nothing is drawn without the question (the editor shows it). */
export function FaqQuestion({ question, answer, dragRef, editing }: FaqQuestionProps) {
  if (!question && !editing) return null;
  return <Disclosure title={question} text={answer} dragRef={dragRef} />;
}

// ---- Countdown -----------------------------------------------------------------------------------------------

export type CountdownBlockProps = { targetAt: string; heading: string; whenExpired: CountdownProps["whenExpired"]; expiredMessage: string };
export function CountdownBlock({ targetAt, heading, whenExpired, expiredMessage }: CountdownBlockProps) {
  if (!targetAt) return null;
  return <Countdown targetAt={targetAt} heading={heading} whenExpired={whenExpired} expiredMessage={expiredMessage} />;
}

// ---- Card grid -----------------------------------------------------------------------------------------------

export type CardGridProps = { columns: "2" | "3" | "4"; items: Slot; editing?: boolean };
const GRID = { "2": "@pair:grid-cols-2", "3": "@pair:grid-cols-2 @cards:grid-cols-3", "4": "@pair:grid-cols-2 @cards:grid-cols-3 @columns:grid-cols-4" } as const;

/** Cards that wrap into rows, each a `GridCard` in the `items` slot; the number of columns is the most the room allows (container queries), up to `columns`. */
export function CardGrid({ columns, items: Items, editing }: CardGridProps) {
  return <Items as="ul" collisionAxis="dynamic" className={`grid gap-5 py-4 ${GRID[columns] ?? GRID["3"]} ${itemList(null, editing)}`} />;
}

export type GridCardProps = { imageAssetId?: string; alt: string; icon?: string; title: string; description?: string; price: string; buttonLabel: string; href: string } & ItemProps;

/** One card of a Card grid: an optional picture or icon, a title, a line, a price and a button (shown only with a usable link). */
export function GridCard({ imageAssetId, alt, icon, title, description, price, buttonLabel, href: link, dragRef, editing }: GridCardProps) {
  if (!title && !editing) return null;
  const src = pageImage(imageAssetId, "event_card");
  const href = safeHref(link);
  return (
    <li ref={dragRef} className="flex flex-col overflow-hidden rounded-xl border-t-4 border-accent bg-tile text-ink shadow-sm">
      {src && (
        // eslint-disable-next-line @next/next/no-img-element -- served by the media route, already sized by its preset
        <img src={src} alt={alt} loading="lazy" className="aspect-video w-full object-cover" />
      )}
      <div className="flex flex-1 flex-col gap-2 p-4">
        {icon && (
          <span aria-hidden="true" className="text-3xl leading-none">
            {icon}
          </span>
        )}
        <h3 className="font-display text-lg font-semibold">{title}</h3>
        {description && <p className="whitespace-pre-line text-sm">{description}</p>}
        {price && <p className="font-semibold text-accent-ink">{price}</p>}
        {buttonLabel && href && (
          <a href={href} className={`${buttonClasses("inherit", "plum", "pill", false)} mt-auto !px-4 !py-2 !text-sm text-center`}>
            {buttonLabel}
          </a>
        )}
      </div>
    </li>
  );
}

// ---- Pricing -------------------------------------------------------------------------------------------------

export type PricingProps = { items: Slot; editing?: boolean };

/** One to three plans side by side (stacked on a narrow container), each a `PricingPlan` in the `items` slot. Cards are as wide as they need and no wider, so one or two plans stay centred. */
export function Pricing({ items: Items, editing }: PricingProps) {
  return <Items as="ul" collisionAxis="dynamic" className={`grid grid-cols-1 gap-5 py-4 text-left @pair:grid-cols-[repeat(auto-fit,minmax(16rem,22rem))] @pair:justify-center ${itemList(ITEM_LIMITS.Pricing, editing)}`} />;
}

export type PricingPlanProps = { name: string; price: string; period: string; description: string; features: string; badge: string; featured: boolean; buttonLabel: string; href: string } & ItemProps;

/**
 * One plan: its name, the price exactly as typed (never parsed or computed) with its billing period or note right after it in the same
 * line, so a screen reader says "$97 per month", a short description, what is included (one line each) and a button. The featured plan
 * is shown by a heavier border and shadow and a "Featured" label for screen readers, not by colour alone; its badge ("Most popular")
 * is words. A button with no usable link is not drawn for a visitor (the publish check asks for the link); the editor shows it disabled.
 */
export function PricingPlan({ name, price, period, description, features, badge, featured, buttonLabel, href: link, dragRef, editing }: PricingPlanProps) {
  if (!name && !price && !editing) return null;
  const href = safeHref(link);
  const included = (features ?? "").split(/\n+/).map((l) => l.trim()).filter(Boolean);
  const look = featured ? "inherit" : "outline";
  return (
    <li ref={dragRef} className={`flex flex-col gap-3 rounded-xl bg-tile p-6 text-ink ${featured ? "border-4 border-accent shadow-xl" : "border border-current shadow-sm"}`}>
      {(badge || featured) && (
        <p className="self-start rounded-full border border-current px-3 py-0.5 text-xs font-semibold text-accent-ink">
          {featured && <span className="sr-only">Featured plan. </span>}
          {badge}
        </p>
      )}
      <h3 className="font-display text-xl font-semibold">{name}</h3>
      {(price || period) && (
        <p>
          <span className="font-display text-4xl font-bold">{price}</span>
          {price && period ? " " : ""}
          {period && <span className="text-sm text-ink-muted">{period}</span>}
        </p>
      )}
      {description && <p className="whitespace-pre-line text-sm">{description}</p>}
      {included.length > 0 && (
        <ul className="space-y-1 text-sm">
          {included.map((line, i) => (
            <li key={i} className="flex gap-2">
              <span aria-hidden="true" className="shrink-0">
                ✓
              </span>
              <span>{line}</span>
            </li>
          ))}
        </ul>
      )}
      {buttonLabel && (href || editing) && (
        <div className="mt-auto pt-2">
          {href ? (
            <a href={href} className={buttonClasses(look, "plum", "pill", true)}>
              {buttonLabel}
            </a>
          ) : (
            <span aria-disabled="true" className={`${buttonClasses(look, "plum", "pill", true)} opacity-50`}>
              {buttonLabel}
            </span>
          )}
        </div>
      )}
    </li>
  );
}

// ---- Social icons --------------------------------------------------------------------------------------------

export type SocialIconsProps = { items: Slot; align: "left" | "center" | "right"; size: "small" | "medium" | "large"; editing?: boolean };
const SOCIAL_JUSTIFY = { left: "justify-start", center: "justify-center", right: "justify-end" } as const;
/** The size of every link in the row: the parent sets it, because an item cannot see its block. Full class strings, so Tailwind finds them. */
const SOCIAL_SIZE = {
  small: "[&_.lp-social]:h-8 [&_.lp-social]:w-8 [&_.lp-social_svg]:h-4 [&_.lp-social_svg]:w-4",
  medium: "[&_.lp-social]:h-10 [&_.lp-social]:w-10 [&_.lp-social_svg]:h-5 [&_.lp-social_svg]:w-5",
  large: "[&_.lp-social]:h-12 [&_.lp-social]:w-12 [&_.lp-social_svg]:h-6 [&_.lp-social_svg]:w-6",
} as const;

/** A row of round icon links, each a `SocialLink` in the `items` slot (eight at most). The colour is the section's text colour, so it reads on any background the theme offers. */
export function SocialIcons({ items: Items, align, size, editing }: SocialIconsProps) {
  return <Items as="ul" collisionAxis="x" className={`my-3 flex flex-wrap gap-3 ${pick(SOCIAL_JUSTIFY, align, "center")} ${pick(SOCIAL_SIZE, size, "medium")} ${itemList(ITEM_LIMITS.SocialIcons, editing)}`} />;
}

export type SocialLinkProps = { network: string; url: string } & ItemProps;

const SOCIAL_LINK = "lp-social inline-flex items-center justify-center rounded-full border border-current no-underline transition-colors hover:bg-accent/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-current focus-visible:ring-offset-2";

/**
 * One link of a Social icons block. Its accessible name is the network's ("Instagram"), the picture is decoration. A link to another site
 * opens in a new tab with `noopener noreferrer`; a `mailto:` does not. With no usable address a visitor sees nothing (the publish
 * check asks for it) and the editor shows the icon disabled.
 */
export function SocialLink({ network, url, dragRef, editing }: SocialLinkProps) {
  const kind = socialNetworkOf(network);
  const label = SOCIAL_NETWORKS[kind];
  const href = safeHref(url);
  if (!href && !editing) return null;
  return (
    <li ref={dragRef}>
      {href ? (
        <a href={href} aria-label={label} className={SOCIAL_LINK} {...(/^https?:/i.test(href) ? { target: "_blank", rel: "noopener noreferrer" } : {})}>
          <SocialMark network={kind} />
        </a>
      ) : (
        <span role="img" aria-label={`${label} (no link yet)`} aria-disabled="true" className={`${SOCIAL_LINK} opacity-50`}>
          <SocialMark network={kind} />
        </span>
      )}
    </li>
  );
}

// ---- Link list -----------------------------------------------------------------------------------------------

export type LinkListProps = { items: Slot; editing?: boolean };

/** A stack of full-width link buttons, each a `LinkItem` in the `items` slot. */
export function LinkList({ items: Items, editing }: LinkListProps) {
  return <Items as="ul" collisionAxis="y" className={`mx-auto my-3 max-w-md space-y-3 ${itemList(null, editing)}`} />;
}

export type LinkItemProps = { label: string; href: string; look: ButtonLook; color: "plum" | "light" | "brown" } & ItemProps;

/** One link of a Link list, drawn as a full-width button. Without a usable address a visitor sees nothing (the publish check asks for it); while editing it shows disabled. */
export function LinkItem({ label, href, look, color, dragRef, editing }: LinkItemProps) {
  const target = safeHref(href);
  if (!(label && target) && !editing) return null;
  const classes = buttonClasses(look, color, "pill", true);
  return (
    <li ref={dragRef}>
      {target && label ? (
        <a href={target} className={classes}>
          {label}
        </a>
      ) : (
        <span aria-disabled="true" className={`${classes} opacity-50`}>
          {label || "Link"}
        </span>
      )}
    </li>
  );
}

// ---- Divider and spacer --------------------------------------------------------------------------------------

export type DividerProps = { look: "line" | "short" };
export function Divider({ look }: DividerProps) {
  return <hr className={`my-6 border-0 border-t-2 border-current opacity-40 ${look === "short" ? "mx-auto w-16" : ""}`} />;
}

export type SpacerProps = { size: "small" | "medium" | "large" };
const SPACE = { small: "h-4", medium: "h-10", large: "h-20" } as const;
export function Spacer({ size }: SpacerProps) {
  return <div aria-hidden="true" className={SPACE[size] ?? SPACE.medium} />;
}

// ---- Video ---------------------------------------------------------------------------------------------------

export type VideoProps = { url: string; title: string };
/** Plays a YouTube, Vimeo or Mux link in a locked-down frame: only those hosts, the address built from the video id alone. */
export function Video({ url, title }: VideoProps) {
  const embed = parseEmbed(url);
  if (!embed) return null;
  return (
    <div className="my-4 aspect-video w-full overflow-hidden rounded-xl bg-black">
      <iframe
        src={embed.src}
        title={title || embed.title}
        loading="lazy"
        allow="accelerometer; encrypted-media; gyroscope; picture-in-picture; fullscreen"
        allowFullScreen
        referrerPolicy="strict-origin-when-cross-origin"
        sandbox="allow-scripts allow-same-origin allow-presentation allow-popups"
        className="h-full w-full border-0"
      />
    </div>
  );
}

// ---- Opt-in form ---------------------------------------------------------------------------------------------

export type OptInBlockProps = Omit<OptInFormProps, "buttonClass"> & { look: ButtonLook; color: "plum" | "light" | "brown"; shape: "pill" | "rect" };

/** A sign-up form (name, email, optional Instagram handle) that goes to Kajabi through our relay; see OptInForm. A form with no Kajabi form chosen shows nothing to visitors. */
export function OptInFormBlock({ look, color, shape, ...props }: OptInBlockProps) {
  if (!props.kajabiFormId?.trim()) return null;
  return <OptInForm {...props} buttonClass={buttonClasses(look, color, shape, true)} />;
}

// ---- Hero, steps, stats and call-to-action banner ------------------------------------------------------------
// Static, ready-made compositions of what staff otherwise assemble from Section, Heading, Text and Button. Their
// colours come from theme.ts only, and their buttons are built like the Button block's (same classes, `safeHref`).

export type LinkProp = { label: string; href: string };

/** One of the buttons in a hero or banner: a link when the address is safe, shown disabled otherwise, nothing without a label. */
function ActionLink({ label, href, look, dark }: Partial<LinkProp> & { look: ButtonLook; dark: boolean }) {
  if (!label) return null;
  const target = safeHref(href);
  const classes = buttonClasses(look, dark ? "light" : "plum", "pill", false);
  return target ? (
    <a href={target} className={classes}>
      {label}
    </a>
  ) : (
    <span aria-disabled="true" className={`${classes} opacity-50`}>
      {label}
    </span>
  );
}

export type HeroProps = {
  headline: string;
  level: "h1" | "h2";
  subhead: string;
  primary: LinkProp;
  secondary: LinkProp;
  imageAssetId?: string;
  alt: string;
  decorative: boolean;
  imageMode: "background" | "side";
  overlay: "none" | "dark" | "light";
  background: string;
  align: "left" | "center";
  /** Space above and below; a page saved without it keeps the original (large). */
  padding?: "none" | "small" | "medium" | "large";
};

/** A page opening: headline (the page title by default), a line under it, up to two buttons and an optional picture, as the band's background under a shade or beside the words. */
export function Hero({ headline, level, subhead, primary, secondary, imageAssetId, alt, decorative, imageMode, overlay, background: bg, align, padding }: HeroProps) {
  const theme = background(bg);
  const src = pageImage(imageAssetId, "event_hero");
  const asBackground = !!src && imageMode !== "side";
  const shade = asBackground ? pick(OVERLAY, overlay, "dark") : "";
  // Over a picture, readable text follows the shade (the editor warns when there is none); otherwise the colour's own.
  const dark = asBackground && overlay !== "none" ? overlay === "dark" : theme.dark;
  const text = asBackground && overlay === "dark" ? "text-white" : asBackground && overlay === "light" ? "text-ink" : theme.text;
  const scope = asBackground ? (overlay === "light" ? "landing-light" : "") : theme.scope;
  const Tag = level === "h2" ? "h2" : "h1";
  const centered = align === "center";
  if (!headline && !subhead && !primary?.label && !secondary?.label && !src) return null;
  return (
    <section
      className={`relative ${theme.bg} ${text} ${scope} ${pick(BAND_SPACE.hero, padding, "large")}`}
      style={asBackground ? { backgroundImage: `url(${src})`, backgroundSize: "cover", backgroundPosition: "center" } : undefined}
    >
      {asBackground && overlay !== "none" && <div aria-hidden="true" className={`absolute inset-0 ${shade}`} />}
      <div className={`relative mx-auto grid max-w-5xl items-center gap-8 px-4 ${src && !asBackground ? "@split:grid-cols-2 @split:gap-12" : ""}`}>
        <div className={centered ? "text-center" : "text-left"}>
          {headline && <Tag className="font-display text-4xl font-semibold leading-tight @pair:text-5xl @columns:text-6xl">{headline}</Tag>}
          {subhead && <p className="mt-4 whitespace-pre-line text-lg @pair:text-xl">{subhead}</p>}
          {(primary?.label || secondary?.label) && (
            <div className={`mt-8 flex flex-wrap gap-3 ${centered ? "justify-center" : ""}`}>
              <ActionLink {...primary} look="inherit" dark={dark} />
              <ActionLink {...secondary} look="outline" dark={dark} />
            </div>
          )}
        </div>
        {src && !asBackground && (
          // eslint-disable-next-line @next/next/no-img-element -- served by the media route, already sized by its preset
          <img src={src} alt={decorative ? "" : alt} className="h-auto w-full rounded-2xl" />
        )}
      </div>
    </section>
  );
}

export type StepsProps = { heading: string; items: Slot; editing?: boolean };


/**
 * Numbered steps, each a `Step` block in the `items` slot: stacked on a narrow page, side by side once there is room (as many
 * columns as fit, so any number of steps fills the row). The number is a CSS counter, so it follows the order the steps are in
 * after a drag. The text colour is inherited, so it follows the section it sits in.
 */
export function Steps({ heading, items: Items, editing }: StepsProps) {
  return (
    <div className="py-4">
      {heading && <h2 className="mb-6 text-center font-display text-3xl font-semibold leading-tight @pair:text-4xl">{heading}</h2>}
      <Items as="ol" collisionAxis="dynamic" className={`grid grid-cols-1 gap-8 [counter-reset:step] @cards:grid-cols-[repeat(auto-fit,minmax(12rem,1fr))] ${itemList(ITEM_LIMITS.Steps, editing)}`} />
    </div>
  );
}

export type StepProps = { title: string; text: string } & ItemProps;

/** One step of a Steps block: a numbered circle, a title (a heading under the block's own) and a line. */
export function Step({ title, text, dragRef, editing }: StepProps) {
  if (!title && !editing) return null;
  return (
    <li ref={dragRef} className="flex min-w-0 flex-col items-center gap-3 text-center [counter-increment:step]">
      <span aria-hidden="true" className="flex h-12 w-12 items-center justify-center rounded-full border-2 border-current text-xl font-semibold before:content-[counter(step)]" />
      <h3 className="font-display text-xl font-semibold">{title}</h3>
      {text && <p className="whitespace-pre-line">{text}</p>}
    </li>
  );
}

export type StatsProps = { items: Slot; editing?: boolean };


/** A strip of typed figures (not live data), each a `Stat` block in the `items` slot. A description list, so a screen reader hears the label with its figure. */
export function Stats({ items: Items, editing }: StatsProps) {
  return <Items as="dl" collisionAxis="dynamic" className={`grid grid-cols-1 gap-8 py-4 text-center @pair:grid-cols-[repeat(auto-fit,minmax(12rem,1fr))] ${itemList(ITEM_LIMITS.Stats, editing)}`} />;
}

export type StatProps = { value: string; label: string } & ItemProps;

/** One figure of a Stats block: the big figure with its label under it (the label comes first in the markup, and is shown below). */
export function Stat({ value, label, dragRef, editing }: StatProps) {
  if (!value && !editing) return null;
  return (
    <div ref={dragRef} className="flex flex-col-reverse">
      <dt className="mt-1 text-base">{label}</dt>
      <dd className="font-display text-4xl font-semibold leading-tight @pair:text-5xl">{value}</dd>
    </div>
  );
}

export type CtaBannerProps = { heading: string; text: string; label: string; href: string; background: string; align: "left" | "center" };

/** A call to action on a coloured band: heading, a line, one button. Colours are the theme's backgrounds with their own readable text; the page colour is not offered, so it is always a band. */
export function CtaBanner({ heading, text, label, href, background: bg, align }: CtaBannerProps) {
  const theme = background(bg === "none" ? "plum" : bg);
  if (!heading && !text && !label) return null;
  return (
    <section className={`my-4 rounded-2xl px-6 py-10 @pair:px-10 ${theme.bg} ${theme.text} ${theme.scope} ${align === "left" ? "text-left" : "text-center"}`}>
      {heading && <h2 className="font-display text-3xl font-semibold leading-tight @pair:text-4xl">{heading}</h2>}
      {text && <p className="mt-3 whitespace-pre-line text-lg">{text}</p>}
      {label && (
        <div className="mt-6">
          <ActionLink label={label} href={href} look="inherit" dark={theme.dark} />
        </div>
      )}
    </section>
  );
}
