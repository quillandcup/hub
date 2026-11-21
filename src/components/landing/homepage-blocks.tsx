import { safeHref } from "@/lib/landing/data";
import { featuredOfferIndex } from "@/lib/landing/journey";
import { buttonClasses, itemList, type ItemProps, type Slot } from "./blocks";
import { ITEM_LIMITS } from "./item-limits";
import JourneyTabs from "./JourneyTabs";
import { BAND_SPACE, pageImage, pick } from "./theme";

/**
 * The homepage's blocks (docs/product/LANDING_PAGES.md, "Homepage blocks"). Static and presentational like the rest: no hooks (the Journey map's client part is `JourneyTabs.tsx`).
 * Typed by hand in the editor; the outcome numbers can be live ("Live data"):
 * they have a `source`, and the server hands them what they show in a render-only `live` prop (they never fetch). The
 * blocks about events (the announcement strip, the schedule panel, coming up) are the events integration's, in src/modules/events/page-blocks/blocks.tsx. Layout is container queries with the named sizes, mobile first. Colours are theme tokens and fixed
 * brand colours only, and wherever a block sets its own background it also sets its own text colour, never inherits it.
 * Heading levels assume the page has a section heading (h2) above: titles inside a block are h3, and h4 under a block
 * heading, which src/lib/landing/a11y.ts mirrors. A link is a prop named `href` (cleaned on save), so a block with several
 * links keeps them in objects (`more`, `compare`, a stage's `link`).
 */

const MAX = { stages: 6, stageOffers: 4 } as const;

/** The items that have the prop the public page needs, up to `max`. Shared with the blocks modules contribute. */
export const rowsOf = <T extends object>(items: T[] | undefined, key: keyof T, max: number) => (items ?? []).filter((i) => i && i[key]).slice(0, max);

/** A link or, with no safe address, nothing: the publish check asks for the address, a visitor never sees a dead link. */
export function TextLink({ label, href, className = "", tone = "default" }: { label?: string; href?: string; className?: string; tone?: "default" | "light" }) {
  const target = safeHref(href);
  if (!label || !target) return null;
  return (
    <a href={target} className={`font-semibold underline underline-offset-4 hover:no-underline ${tone === "light" ? "text-white" : "text-accent-ink"} ${className}`}>
      {label}
    </a>
  );
}

/** A button as the Button block draws it (same classes, `safeHref`), shown disabled when it has no usable link. */
function LinkButton({ label, href, color = "plum", full = false }: { label?: string; href?: string; color?: "plum" | "light"; full?: boolean }) {
  if (!label) return null;
  const target = safeHref(href);
  const classes = buttonClasses("inherit", color, "pill", full);
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

// ---- Outcome numbers -------------------------------------------------------------------------------------------

/**
 * A figure is typed by hand, or (`source` "live") bound to a figure from the live registry (`stat`, src/lib/landing/live-stats.ts):
 * the server puts the formatted figure in the item's `live` for one render and the typed `value` stays as the fallback. With a
 * live figure and no typed label, the figure's own caption is the label. `live.note` is the block's "show a live note" switch,
 * copied in by the server because an item cannot see its block.
 */
export type OutcomeFigure = { value: string; label: string; note: string; source?: "manual" | "live"; stat?: string; live?: { value: string; caption: string; note?: boolean } };
export type OutcomeNumbersProps = { items: Slot; padding?: "none" | "small" | "medium" | "large"; showLiveNote?: boolean; editing?: boolean };

/** A full-width white band with a gold stripe on top: two to four big figures (each an `OutcomeNumber` block in the `items` slot), typed by hand or live. Every colour is set here (plum numbers, dark ink labels), so nothing depends on the band it sits in. */
export function OutcomeNumbers({ items: Items, padding, editing }: OutcomeNumbersProps) {
  return (
    <section className={`landing-light border-t-8 border-gold bg-white text-ink ${pick(BAND_SPACE.figures, padding, "medium")} ${editing ? "" : "[&:not(:has(dd))]:hidden"}`}>
      <Items as="dl" collisionAxis="dynamic" className={`mx-auto grid max-w-5xl grid-cols-1 gap-8 px-4 text-center @pair:grid-cols-[repeat(auto-fit,minmax(10rem,1fr))] ${itemList(ITEM_LIMITS.OutcomeNumbers, editing)}`} />
    </section>
  );
}

export type OutcomeNumberProps = OutcomeFigure & ItemProps;

/** One figure of an Outcome numbers block. Nothing is drawn with neither a typed nor a live figure. */
export function OutcomeNumber({ value, label, note, live, dragRef, editing }: OutcomeNumberProps) {
  if (!(value || live?.value) && !editing) return null;
  return (
    <div ref={dragRef} className="flex flex-col-reverse">
      <dt className="mt-1 text-base font-semibold text-ink">
        {live ? label || live.caption : label}
        {note && <span className="ml-2 text-sm font-medium text-emerald-800">({note})</span>}
        {live && live.note !== false && (
          <span className="ml-2 inline-flex items-center gap-1 text-sm font-medium text-emerald-800">
            <span aria-hidden="true" className="landing-pulse inline-block h-2 w-2 rounded-full bg-emerald-700" />
            live
          </span>
        )}
      </dt>
      <dd className="font-display text-5xl font-semibold leading-tight text-plum-900 @pair:text-6xl">{live ? live.value : value}</dd>
    </div>
  );
}

// ---- Finisher cards --------------------------------------------------------------------------------------------

export type FinisherCardsProps = { items: Slot; more: { label: string; href: string }; editing?: boolean };

/** The cards of the block, in the order they are in the `items` slot (a drag on the canvas reorders them). */
export function FinisherCards({ items: Items, more, editing }: FinisherCardsProps) {
  return (
    <div className="py-4">
      <Items as="ul" collisionAxis="dynamic" className={`grid grid-cols-2 gap-5 text-left @cards:grid-cols-3 ${itemList(ITEM_LIMITS.FinisherCards, editing)}`} />
      {more?.label && safeHref(more.href) && (
        <p className="mt-6 text-center">
          <TextLink label={more.label} href={more.href} />
        </p>
      )}
    </div>
  );
}

export type FinisherCardProps = { imageAssetId?: string; alt: string; name: string; kind: string; dayOne: string; theEnd: string; linkLabel: string; href: string } & ItemProps;

/** One Finisher of a Finisher cards block: a photo-first card in a book-cover shape: who, what she wrote, where she started (Day 1) and what she finished (THE END). With no picture, a soft placeholder, never an error. */
export function FinisherCard({ imageAssetId, alt, name, kind, dayOne, theEnd, linkLabel, href, dragRef, editing }: FinisherCardProps) {
  if (!name && !editing) return null;
  const src = pageImage(imageAssetId, "event_card");
  return (
    <li ref={dragRef} className="flex min-w-0 flex-col gap-3">
      <div className="aspect-[3/4] overflow-hidden rounded-xl shadow-md">
        {src ? (
          // eslint-disable-next-line @next/next/no-img-element -- served by the media route, already sized by its preset
          <img src={src} alt={alt ?? ""} loading="lazy" className="h-full w-full object-cover" />
        ) : (
          <div aria-hidden="true" className="flex h-full w-full items-center justify-center bg-gradient-to-br from-plum-200 to-plum-400 text-5xl">
            📖
          </div>
        )}
      </div>
      <div className="space-y-1">
        <h3 className="font-display text-xl font-semibold leading-tight">{name}</h3>
        {kind && <p className="text-sm">{kind}</p>}
        {dayOne && (
          <p className="text-sm">
            <span className="font-semibold">Day 1:</span> {dayOne}
          </p>
        )}
        {theEnd && (
          <p className="text-sm">
            <span className="font-semibold">THE END:</span> {theEnd}
          </p>
        )}
        <TextLink label={linkLabel} href={href} className="inline-block pt-1 text-sm" />
      </div>
    </li>
  );
}

// ---- Timeline --------------------------------------------------------------------------------------------------

export type TimelineProps = { heading: string; intro: string; items: Slot; closing: string; editing?: boolean };

/** A vertical timeline: a line down the left with a dot for each moment (a `TimelineMoment` in the `items` slot), an optional heading and intro above and a closing line below. */
export function Timeline({ heading, intro, items: Items, closing, editing }: TimelineProps) {
  return (
    <div className="mx-auto max-w-3xl py-4 text-left">
      {heading && <h3 className="font-display text-2xl font-semibold leading-tight">{heading}</h3>}
      {intro && <p className="mt-2 whitespace-pre-line text-lg">{intro}</p>}
      <Items as="ol" collisionAxis="y" className={`ml-2 mt-6 border-l-4 border-accent pl-6 ${itemList(ITEM_LIMITS.Timeline, editing)}`} />
      {closing && <p className="mt-8 border-l-4 border-gold pl-4 font-display text-xl italic">{closing}</p>}
    </div>
  );
}

export type TimelineMomentProps = { when: string; title: string; text: string } & ItemProps;

/** One moment of a Timeline: its time, a title (an h3, a level below the section's heading) and a short text, with a dot on the line. */
export function TimelineMoment({ when, title, text, dragRef, editing }: TimelineMomentProps) {
  if (!title && !editing) return null;
  return (
    <li ref={dragRef} className="relative pb-6 last:pb-0">
      <span aria-hidden="true" className="absolute -left-[2.1rem] top-1.5 h-3.5 w-3.5 rounded-full bg-accent" />
      {when && <p className="text-sm font-bold uppercase tracking-wide text-accent-ink">{when}</p>}
      <h3 className="font-display text-xl font-semibold leading-tight">{title}</h3>
      {text && <p className="mt-1 whitespace-pre-line">{text}</p>}
    </li>
  );
}

// ---- Week strip ------------------------------------------------------------------------------------------------

export type WeekStripProps = { subtitle: string; items: Slot; editing?: boolean };

/** Up to seven day cards in a row (two columns on a narrow page, then as many as fit), each a `WeekDay` in the `items` slot: dragging a day on the canvas reorders the week. */
export function WeekStrip({ subtitle, items: Items, editing }: WeekStripProps) {
  return (
    <div className="py-4">
      {subtitle && <p className="mb-6 text-center text-lg">{subtitle}</p>}
      <Items as="ol" collisionAxis="dynamic" className={`grid grid-cols-2 gap-3 @cards:grid-cols-[repeat(auto-fit,minmax(8rem,1fr))] ${itemList(ITEM_LIMITS.WeekStrip, editing)}`} />
    </div>
  );
}

export type WeekDayProps = { label: string; emoji: string; text: string; note: string } & ItemProps;

/** One day of a Week strip: a label, an emoji, what happens and a small note. A card on its own colours, so it reads apart from the schedule panel and the timeline. */
export function WeekDay({ label, emoji, text, note, dragRef, editing }: WeekDayProps) {
  if (!label && !editing) return null;
  return (
    <li ref={dragRef} className="flex min-w-0 flex-col items-center gap-1 rounded-xl border-b-4 border-accent bg-card p-3 text-center text-ink shadow-md">
      <p className="text-xs font-bold uppercase tracking-widest text-accent-ink">{label}</p>
      {emoji && (
        <span aria-hidden="true" className="text-3xl leading-none">
          {emoji}
        </span>
      )}
      {text && <p className="font-semibold">{text}</p>}
      {note && <p className="text-sm text-ink-muted">{note}</p>}
    </li>
  );
}

// ---- Finish-line cards -----------------------------------------------------------------------------------------

export type FinishLineCardsProps = { items: Slot; editing?: boolean };
/** A card's gradient follows its place in the list, so a dragged card takes the next one's colour (the order is the page's, not the card's). Written out, so Tailwind finds each class. */
const FINISH_GRADIENTS = "[&:nth-child(3n+1)]:from-plum-700 [&:nth-child(3n+1)]:to-plum-600 [&:nth-child(3n+2)]:from-brown-deep [&:nth-child(3n+2)]:to-brown [&:nth-child(3n)]:from-plum-950 [&:nth-child(3n)]:to-plum-800";
const percent = (value: unknown) => Math.min(100, Math.max(0, Math.round(Number(value) || 0)));

/** Two or three big gradient cards, each a `FinishLineCard` in the `items` slot (as many columns as fit, from the split size). */
export function FinishLineCards({ items: Items, editing }: FinishLineCardsProps) {
  return <Items as="ul" collisionAxis="dynamic" className={`grid gap-5 py-4 text-left @split:grid-cols-[repeat(auto-fit,minmax(16rem,1fr))] ${itemList(ITEM_LIMITS.FinishLineCards, editing)}`} />;
}

export type FinishLineCardProps = { title: string; program: string; text: string; durationLabel: string; durationPercent: number; buttonLabel: string; href: string } & ItemProps;

/** One finish line: a goal, the program behind it, a line, a duration bar with its label and one button. White text on the card's own gradient, whatever the section behind it. */
export function FinishLineCard({ title, program, text, durationLabel, durationPercent, buttonLabel, href, dragRef, editing }: FinishLineCardProps) {
  if (!title && !editing) return null;
  return (
    <li ref={dragRef} className={`flex min-w-0 flex-col gap-3 rounded-2xl bg-gradient-to-br from-plum-700 to-plum-600 p-6 text-white shadow-lg ${FINISH_GRADIENTS}`}>
      <h3 className="font-display text-2xl font-semibold leading-tight">{title}</h3>
      {program && <p className="font-bold">{program}</p>}
      {text && <p>{text}</p>}
      {durationLabel && (
        <div>
          <p className="mb-1 text-right text-sm">{durationLabel}</p>
          <div aria-hidden="true" className="h-3.5 overflow-hidden rounded-full bg-white/25">
            <div className="h-full rounded-full bg-white" style={{ width: `${percent(durationPercent)}%` }} />
          </div>
        </div>
      )}
      <div className="mt-auto pt-2">
        <LinkButton label={buttonLabel} href={href} color="light" />
      </div>
    </li>
  );
}

// ---- Plan phases -----------------------------------------------------------------------------------------------

export type PlanPhasesProps = { heading: string; items: Slot; editing?: boolean };
/** Each phase a shade deeper than the one before, by its place in the list (a fifth and later take the deepest). */
const PHASE_SHADES = "bg-plum-100 [&:nth-child(2)]:bg-plum-200 [&:nth-child(3)]:bg-plum-300 [&:nth-child(n+4)]:bg-plum-400";

/** Two to four phases of a plan, each a `PlanPhase` in the `items` slot: a panel a shade deeper than the one before (light to deeper plum), with dark text set on every one. */
export function PlanPhases({ heading, items: Items, editing }: PlanPhasesProps) {
  return (
    <div className="py-4 text-left">
      {heading && <h3 className="mb-4 font-display text-2xl font-semibold leading-tight">{heading}</h3>}
      <Items as="ol" collisionAxis="dynamic" className={`grid overflow-hidden rounded-xl @pair:grid-cols-[repeat(auto-fit,minmax(10rem,1fr))] ${itemList(ITEM_LIMITS.PlanPhases, editing)}`} />
    </div>
  );
}

export type PlanPhaseProps = { title: string; text: string } & ItemProps;

/** One phase of a plan: a title and what happens. */
export function PlanPhase({ title, text, dragRef, editing }: PlanPhaseProps) {
  if (!title && !editing) return null;
  return (
    <li ref={dragRef} className={`min-w-0 p-4 text-plum-950 ${PHASE_SHADES}`}>
      <p className="font-bold">{title}</p>
      {text && <p className="mt-1">{text}</p>}
    </li>
  );
}

// ---- Journey map -----------------------------------------------------------------------------------------------

export type OfferStatus = "open" | "waitlist" | "soon" | "dates";
export const OFFER_STATUS = {
  open: { label: "Open", cls: "bg-emerald-100 text-emerald-900" },
  waitlist: { label: "Waitlist", cls: "bg-gold text-gold-ink" },
  soon: { label: "Coming soon", cls: "bg-plum-100 text-plum-900" },
  dates: { label: "Dates announced", cls: "bg-mist-200 text-mist-950" },
} as const;
const offerStatus = (status: unknown) => OFFER_STATUS[(typeof status === "string" && status in OFFER_STATUS ? status : "open") as OfferStatus];

export type JourneyOffer = { status: OfferStatus; statusLabel: string; title: string; text: string; buttonLabel: string; href: string; featured?: boolean };
export type JourneyStage = { name: string; helps: string; current: boolean; note?: string; link?: { label: string; href: string }; offers?: JourneyOffer[] };
export type JourneyMapProps = {
  stages: JourneyStage[];
  compare: { label: string; href: string };
};

/**
 * What one stage shows under the stepper, as one panel (the tab list's shell, `JourneyTabs`, draws its frame and left rail):
 * the featured offer large (status, title, text, button) and the stage's other offers as a compact "Also for <stage>" list of links.
 * The featured offer is the one marked `featured`, else the first, so a page saved before the option behaves as it did (the first
 * offer leads). A stage with one offer has no list; one with none shows its note and optional link.
 */
function StagePanel({ stage }: { stage: JourneyStage }) {
  const offers = rowsOf(stage.offers, "title", MAX.stageOffers);
  if (offers.length === 0) {
    if (!stage.note && !(stage.link?.label && safeHref(stage.link.href))) return null;
    return (
      <div className="space-y-2 text-center">
        {stage.note && <p className="font-semibold">{stage.note}</p>}
        <TextLink label={stage.link?.label} href={stage.link?.href} />
      </div>
    );
  }
  const lead = featuredOfferIndex(offers);
  const featured = offers[lead];
  const others = offers.filter((_, i) => i !== lead);
  const status = offerStatus(featured.status);
  return (
    <div className={others.length > 0 ? "grid gap-6 @split:grid-cols-[3fr_2fr] @split:gap-8" : ""}>
      <div className="flex flex-col items-start gap-3">
        <span className={`rounded-full px-3 py-0.5 text-sm font-bold ${status.cls}`}>{featured.statusLabel || status.label}</span>
        <h3 className="font-display text-3xl font-semibold leading-tight">{featured.title}</h3>
        {featured.text && <p className="text-lg">{featured.text}</p>}
        <div className="pt-1">
          <LinkButton label={featured.buttonLabel} href={featured.href} />
        </div>
      </div>
      {others.length > 0 && (
        <div className="border-t border-ink-muted/30 pt-5 @split:border-l @split:border-t-0 @split:pl-8 @split:pt-0">
          <p className="mb-2 font-bold text-accent-ink">{`Also for ${stage.name}`}</p>
          <ul className="divide-y divide-ink-muted/30">
            {others.map((offer, i) => {
              const href = safeHref(offer.href);
              return (
                <li key={i} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-3 first:pt-0 last:pb-0">
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold">{offer.title}</p>
                    {offer.text && <p className="text-sm text-ink-muted">{offer.text}</p>}
                  </div>
                  {href && (
                    <a href={href} className="whitespace-nowrap font-semibold text-accent-ink underline underline-offset-4 hover:no-underline">
                      See it <span aria-hidden="true">→</span>
                      <span className="sr-only"> {offer.title}</span>
                    </a>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

/**
 * Stages of a book as a connected stepper (a column on a narrow page, a row with room). Choosing a stage shows its programs
 * under it (`JourneyTabs`, the one client part); the stage marked `current` is the one chosen on load, the first without one.
 * Every panel is in the server's HTML. A "compare" link sits under the panel. A stage's offers are not equal: one is featured
 * (large), the rest are a short list of links.
 */
export function JourneyMap({ stages, compare }: JourneyMapProps) {
  const rows = rowsOf(stages, "name", MAX.stages);
  if (rows.length === 0) return null;
  const current = rows.findIndex((s) => s.current);
  return (
    <div className="py-4 text-left">
      <JourneyTabs initial={Math.max(current, 0)} tabs={rows.map((stage) => ({ name: stage.name, helps: stage.helps, panel: <StagePanel stage={stage} /> }))} />
      {compare?.label && safeHref(compare.href) && (
        <p className="mt-5">
          <TextLink label={compare.label} href={compare.href} />
        </p>
      )}
    </div>
  );
}
