import type { ReactNode } from "react";
import { parseEmbed, safeHref } from "@/lib/landing/data";
import Countdown, { type CountdownProps } from "./Countdown";
import OptInForm, { type OptInFormProps } from "./OptInForm";
import { background, pageImage, pick, PADDING, WIDTHS } from "./theme";

/**
 * The page builder's blocks as plain components: the same ones render in the editor's canvas and on the public page
 * (docs/LANDING_PAGES.md). No hooks and no browser APIs here (the countdown is its own client component), so the
 * public route renders them on the server. Layout inside the page uses container queries (`@container` is on the page
 * wrapper, see PageFrame) with the named sizes from tailwind.config.ts, so a block reflows with the room it has, in the
 * editor's phone preview as on a phone. Links go through `safeHref`; rich text arrives already cleaned.
 */

type Slot = (props?: { className?: string }) => ReactNode;
const noImage = null;

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
  const text = image && overlay === "dark" ? "text-white" : image && overlay === "light" ? "text-slate-900" : theme.text;
  return (
    <section
      className={`relative ${theme.bg} ${text} ${pick(PADDING, padding, "medium").cls} ${fadeIn ? "landing-fade-in" : ""}`}
      style={image ? { backgroundImage: `url(${image})`, backgroundSize: "cover", backgroundPosition: "center" } : undefined}
    >
      {image && overlay !== "none" && <div aria-hidden="true" className={`absolute inset-0 ${OVERLAY[overlay]}`} />}
      <div className={`relative mx-auto px-4 ${pick(WIDTHS, width, "wide").cls} ${alignClass(align === "center" ? "center" : "left")}`}>
        {card ? (
          <div className="rounded-xl bg-white p-6 text-slate-900 shadow-lg @pair:p-10">
            <Content />
          </div>
        ) : (
          <Content />
        )}
      </div>
    </section>
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
  outline: { plum: "border-2 border-current text-plum-700 hover:bg-plum-50", light: "border-2 border-current text-cream hover:bg-white/10", brown: "border-2 border-current text-brown hover:bg-cream" },
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
        <figure key={i} className="rounded-xl bg-white p-5 text-slate-900 shadow">
          <blockquote className="whitespace-pre-line">“{t.quote}”</blockquote>
          {(t.name || t.detail) && (
            <figcaption className="mt-3 text-sm">
              <span className="font-semibold">{t.name}</span>
              {t.detail && <span className="block text-slate-600">{t.detail}</span>}
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

export type CardGridProps = { columns: "2" | "3" | "4"; items: { imageAssetId?: string; alt: string; title: string; price: string; buttonLabel: string; href: string }[] };
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
          <li key={i} className="flex flex-col overflow-hidden rounded-xl bg-white text-slate-900 shadow">
            {src && (
              // eslint-disable-next-line @next/next/no-img-element -- served by the media route, already sized by its preset
              <img src={src} alt={card.alt} loading="lazy" className="aspect-video w-full object-cover" />
            )}
            <div className="flex flex-1 flex-col gap-2 p-4">
              <h3 className="font-display text-lg font-semibold">{card.title}</h3>
              {card.price && <p className="text-slate-700">{card.price}</p>}
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
