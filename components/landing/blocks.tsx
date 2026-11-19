import type { ReactNode } from "react";
import { parseEmbed, safeHref } from "@/lib/landing/data";
import Countdown, { type CountdownProps } from "./Countdown";
import OptInForm, { type OptInFormProps } from "./OptInForm";
import { background, BAND_SPACE, pageImage, pick, PADDING, WIDTHS } from "./theme";

/**
 * The page builder's blocks as plain components: the same ones render in the editor's canvas and on the public page
 * (docs/LANDING_PAGES.md). No hooks and no browser APIs here (the countdown is its own client component), so the
 * public route renders them on the server. Layout inside the page uses container queries (`@container` is on the page
 * wrapper, see PageFrame) with the named sizes from tailwind.config.ts, so a block reflows with the room it has, in the
 * editor's phone preview as on a phone. Links go through `safeHref`; rich text arrives already cleaned.
 */

type Slot = (props?: { className?: string }) => ReactNode;
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
  // `html` is cleaned to an allowlist on save and again before a public render (lib/landing/sanitize.ts), never raw.
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
  padding: string;
  align: "left" | "center";
  card: boolean;
  fadeIn: boolean;
  content: Slot;
};

/** A full-width band with a background colour or picture, and a column of other blocks inside it. */
export function Section({ background: bg, backgroundImageAssetId, overlay, width, padding, align, card, fadeIn, content: Content }: SectionProps) {
  const theme = background(bg);
  const image = pageImage(backgroundImageAssetId, "event_hero");
  // Over a picture, readable text follows the overlay (the editor warns when there is none); without one, the colour's own.
  const text = image && overlay === "dark" ? "text-white" : image && overlay === "light" ? "text-ink" : theme.text;
  const scope = image ? (overlay === "light" ? "landing-light" : "") : theme.scope;
  return (
    <section
      className={`relative ${theme.bg} ${text} ${scope} ${pick(PADDING, padding, "medium").cls} ${fadeIn ? "landing-fade-in" : ""}`}
      style={image ? { backgroundImage: `url(${image})`, backgroundSize: "cover", backgroundPosition: "center" } : undefined}
    >
      {image && overlay !== "none" && <div aria-hidden="true" className={`absolute inset-0 ${OVERLAY[overlay]}`} />}
      <div className={`relative mx-auto px-4 ${pick(WIDTHS, width, "wide").cls} ${alignClass(align === "center" ? "center" : "left")}`}>
        {card ? (
          <div className="rounded-xl bg-card p-6 text-ink shadow-lg @pair:p-10">
            <Content className={SLOT_CLASS} />
          </div>
        ) : (
          <Content className={SLOT_CLASS} />
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

export type ButtonProps = { label: string; href: string; look: "solid" | "outline"; color: "plum" | "light" | "brown"; shape: "pill" | "rect"; align: "left" | "center" | "right"; full: boolean };
const BUTTON_COLORS = {
  solid: { plum: "bg-plum-600 text-white hover:bg-plum-700", light: "bg-cream text-plum-900 hover:bg-white", brown: "bg-brown text-white hover:bg-brown-deep" },
  outline: { plum: "border-2 border-current text-accent-ink hover:bg-accent/10", light: "border-2 border-current text-cream hover:bg-white/10", brown: "border-2 border-current text-warm hover:bg-accent/10" },
} as const;
const JUSTIFY = { left: "text-left", center: "text-center", right: "text-right" } as const;

export function buttonClasses(look: unknown, color: unknown, shape: unknown, full: boolean) {
  const l = look === "outline" ? "outline" : "solid";
  const c = color === "light" || color === "brown" ? color : "plum";
  return `inline-block ${full ? "w-full text-center" : ""} ${shape === "rect" ? "rounded-md" : "rounded-full"} px-6 py-3 text-base font-semibold no-underline transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 ${BUTTON_COLORS[l][c]}`;
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

// ---- Image ---------------------------------------------------------------------------------------------------

export type ImageProps = { imageAssetId?: string; alt: string; decorative: boolean; size: "small" | "medium" | "full"; rounded: boolean; align: "left" | "center" | "right" };
const IMAGE_SIZE = { small: "max-w-xs", medium: "max-w-xl", full: "max-w-full" } as const;
const IMAGE_ALIGN = { left: "mr-auto", center: "mx-auto", right: "ml-auto" } as const;

export function Image({ imageAssetId, alt, decorative, size, rounded, align }: ImageProps) {
  const src = pageImage(imageAssetId, "event_hero");
  if (!src) return noImage;
  return (
    // eslint-disable-next-line @next/next/no-img-element -- served by the media route, already sized by its preset
    <img src={src} alt={decorative ? "" : alt} loading="lazy" className={`my-3 h-auto w-full ${pick(IMAGE_SIZE, size, "medium")} ${pick(IMAGE_ALIGN, align, "center")} ${rounded ? "rounded-2xl" : ""}`} />
  );
}

// ---- Split: image and text -----------------------------------------------------------------------------------

export type SplitProps = { imageAssetId?: string; alt: string; decorative: boolean; imageSide: "left" | "right"; html: string };
/** Picture and words side by side once there is room (`@split`), stacked (picture first) below it; `imageSide` only matters side by side. */
export function Split({ imageAssetId, alt, decorative, imageSide, html }: SplitProps) {
  const src = pageImage(imageAssetId, "event_hero");
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

export type ListProps = { items: { text: string; icon: string }[]; align: "left" | "center" };
export function List({ items, align }: ListProps) {
  const rows = (items ?? []).filter((i) => i.text);
  if (rows.length === 0) return null;
  return (
    <ul className={`my-3 space-y-2 ${align === "center" ? "mx-auto w-fit" : ""}`}>
      {rows.map((item, i) => (
        <li key={i} className="flex gap-3">
          <span aria-hidden="true" className="shrink-0">
            {item.icon || "✓"}
          </span>
          <span>{item.text}</span>
        </li>
      ))}
    </ul>
  );
}

// ---- Testimonials --------------------------------------------------------------------------------------------

export type TestimonialsProps = { items: { quote: string; name: string; detail: string }[] };
export function Testimonials({ items }: TestimonialsProps) {
  const rows = (items ?? []).filter((i) => i.quote);
  if (rows.length === 0) return null;
  return (
    <div className="grid gap-4 py-4 @cards:grid-cols-2">
      {rows.map((t, i) => (
        <figure key={i} className="rounded-xl border-t-4 border-accent bg-tile p-5 text-ink shadow-sm">
          <blockquote className="whitespace-pre-line">“{t.quote}”</blockquote>
          {(t.name || t.detail) && (
            <figcaption className="mt-3 text-sm">
              <span className="font-semibold">{t.name}</span>
              {t.detail && <span className="block text-ink-muted">{t.detail}</span>}
            </figcaption>
          )}
        </figure>
      ))}
    </div>
  );
}

// ---- FAQ -----------------------------------------------------------------------------------------------------

export type FaqProps = { items: { question: string; answer: string }[] };
/** Native disclosure elements: keyboard and screen reader support without script. */
export function Faq({ items }: FaqProps) {
  const rows = (items ?? []).filter((i) => i.question);
  if (rows.length === 0) return null;
  return (
    <div className="my-3 divide-y divide-current rounded-lg border border-current">
      {rows.map((q, i) => (
        <details key={i} className="group p-4">
          <summary className="cursor-pointer list-none font-semibold marker:hidden [&::-webkit-details-marker]:hidden">
            <span className="flex items-center justify-between gap-3">
              {q.question}
              <span aria-hidden="true" className="transition-transform group-open:rotate-45">
                +
              </span>
            </span>
          </summary>
          <div className="mt-2 space-y-2">
            {(q.answer ?? "").split(/\n+/).filter(Boolean).map((line, j) => (
              <p key={j}>{line}</p>
            ))}
          </div>
        </details>
      ))}
    </div>
  );
}

// ---- Countdown -----------------------------------------------------------------------------------------------

export type CountdownBlockProps = { targetAt: string; heading: string; whenExpired: CountdownProps["whenExpired"]; expiredMessage: string };
export function CountdownBlock({ targetAt, heading, whenExpired, expiredMessage }: CountdownBlockProps) {
  if (!targetAt) return null;
  return <Countdown targetAt={targetAt} heading={heading} whenExpired={whenExpired} expiredMessage={expiredMessage} />;
}

// ---- Card grid -----------------------------------------------------------------------------------------------

export type CardGridProps = { columns: "2" | "3" | "4"; items: { imageAssetId?: string; alt: string; icon?: string; title: string; description?: string; price: string; buttonLabel: string; href: string }[] };
const GRID = { "2": "@pair:grid-cols-2", "3": "@pair:grid-cols-2 @cards:grid-cols-3", "4": "@pair:grid-cols-2 @cards:grid-cols-3 @columns:grid-cols-4" } as const;

/** Cards that wrap into rows; the number of columns is the most the room allows (container queries), up to `columns`. */
export function CardGrid({ columns, items }: CardGridProps) {
  const rows = (items ?? []).filter((i) => i.title);
  if (rows.length === 0) return null;
  return (
    <ul className={`grid gap-5 py-4 ${GRID[columns] ?? GRID["3"]}`}>
      {rows.map((card, i) => {
        const src = pageImage(card.imageAssetId, "event_card");
        const href = safeHref(card.href);
        return (
          <li key={i} className="flex flex-col overflow-hidden rounded-xl border-t-4 border-accent bg-tile text-ink shadow-sm">
            {src && (
              // eslint-disable-next-line @next/next/no-img-element -- served by the media route, already sized by its preset
              <img src={src} alt={card.alt} loading="lazy" className="aspect-video w-full object-cover" />
            )}
            <div className="flex flex-1 flex-col gap-2 p-4">
              {card.icon && (
                <span aria-hidden="true" className="text-3xl leading-none">
                  {card.icon}
                </span>
              )}
              <h3 className="font-display text-lg font-semibold">{card.title}</h3>
              {card.description && <p className="text-sm">{card.description}</p>}
              {card.price && <p className="font-semibold text-accent-ink">{card.price}</p>}
              {card.buttonLabel && href && (
                <a href={href} className="mt-auto rounded-full bg-plum-600 px-4 py-2 text-center text-sm font-semibold text-white no-underline hover:bg-plum-700">
                  {card.buttonLabel}
                </a>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

// ---- Link list -----------------------------------------------------------------------------------------------

export type LinkListProps = { items: { label: string; href: string }[]; look: "solid" | "outline"; color: "plum" | "light" | "brown" };
export function LinkList({ items, look, color }: LinkListProps) {
  const rows = (items ?? []).filter((i) => i.label && safeHref(i.href));
  if (rows.length === 0) return null;
  return (
    <ul className="mx-auto my-3 max-w-md space-y-3">
      {rows.map((link, i) => (
        <li key={i}>
          <a href={safeHref(link.href)} className={buttonClasses(look, color, "pill", true)}>
            {link.label}
          </a>
        </li>
      ))}
    </ul>
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

export type OptInBlockProps = Omit<OptInFormProps, "buttonClass"> & { look: "solid" | "outline"; color: "plum" | "light" | "brown"; shape: "pill" | "rect" };

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
function ActionLink({ label, href, look, dark }: Partial<LinkProp> & { look: "solid" | "outline"; dark: boolean }) {
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
              <ActionLink {...primary} look="solid" dark={dark} />
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

export type StepsProps = { heading: string; items: { title: string; text: string }[] };
const STEP_COLUMNS = ["", "", "@pair:grid-cols-2", "@cards:grid-cols-3", "@cards:grid-cols-2 @columns:grid-cols-4", "@cards:grid-cols-3 @columns:grid-cols-5"] as const;

/** Numbered steps: stacked on a narrow page, side by side once there is room. The text colour is inherited, so it follows the section it sits in. */
export function Steps({ heading, items }: StepsProps) {
  const rows = (items ?? []).filter((i) => i.title).slice(0, 5);
  if (rows.length === 0) return null;
  // Under the block's own heading the steps are one level down; without one they are the section headings themselves.
  const StepTitle = heading ? "h3" : "h2";
  return (
    <div className="py-4">
      {heading && <h2 className="mb-6 text-center font-display text-3xl font-semibold leading-tight @pair:text-4xl">{heading}</h2>}
      <ol className={`grid gap-8 ${STEP_COLUMNS[rows.length]}`}>
        {rows.map((step, i) => (
          <li key={i} className="flex flex-col items-center gap-3 text-center">
            <span aria-hidden="true" className="flex h-12 w-12 items-center justify-center rounded-full border-2 border-current text-xl font-semibold">
              {i + 1}
            </span>
            <StepTitle className="font-display text-xl font-semibold">{step.title}</StepTitle>
            {step.text && <p className="whitespace-pre-line">{step.text}</p>}
          </li>
        ))}
      </ol>
    </div>
  );
}

export type StatsProps = { items: { value: string; label: string }[] };
const STAT_COLUMNS = ["", "", "@pair:grid-cols-2", "@pair:grid-cols-3", "@pair:grid-cols-2 @columns:grid-cols-4"] as const;

/** A strip of typed figures (not live data) with a label under each. A description list, so a screen reader hears the label with its figure. */
export function Stats({ items }: StatsProps) {
  const rows = (items ?? []).filter((i) => i.value).slice(0, 4);
  if (rows.length === 0) return null;
  return (
    <dl className={`grid gap-8 py-4 text-center ${STAT_COLUMNS[rows.length]}`}>
      {rows.map((stat, i) => (
        <div key={i} className="flex flex-col-reverse">
          <dt className="mt-1 text-base">{stat.label}</dt>
          <dd className="font-display text-4xl font-semibold leading-tight @pair:text-5xl">{stat.value}</dd>
        </div>
      ))}
    </dl>
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
          <ActionLink label={label} href={href} look="solid" dark={theme.dark} />
        </div>
      )}
    </section>
  );
}
