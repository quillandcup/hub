import { eventArt } from "@/components/EventArt";
import type { EventType } from "@/lib/events-filter";
import { safeHref } from "@/lib/landing/data";
import { featuredOfferIndex } from "@/lib/landing/journey";
import { COMING_UP_KIND_LABELS, COMING_UP_LIST_HEADING } from "@/lib/landing/live-kinds";
import { buttonClasses, itemList, type ItemProps, type Slot } from "./blocks";
import { ITEM_LIMITS } from "./item-limits";
import JourneyTabs from "./JourneyTabs";
import { BAND_SPACE, pageImage, pick } from "./theme";

/**
 * The homepage's blocks (docs/product/LANDING_PAGES.md, "Homepage blocks"). Static and presentational like the rest: no hooks (the Journey map's client part is `JourneyTabs.tsx`).
 * Typed by hand in the editor; the announcement strip, schedule panel and outcome numbers can be live ("Live data"):
 * they have a `source`, and the server hands them what they show in a render-only `live` prop (they never fetch). Layout is container queries with the named sizes, mobile first. Colours are theme tokens and fixed
 * brand colours only, and wherever a block sets its own background it also sets its own text colour, never inherits it.
 * Heading levels assume the page has a section heading (h2) above: titles inside a block are h3, and h4 under a block
 * heading, which lib/landing/a11y.ts mirrors. A link is a prop named `href` (cleaned on save), so a block with several
 * links keeps them in objects (`more`, `compare`, a stage's `link`).
 */

const MAX = { comingUp: 4, outcomes: 4, stages: 6, stageOffers: 4 } as const;

const rowsOf = <T extends object>(items: T[] | undefined, key: keyof T, max: number) => (items ?? []).filter((i) => i && i[key]).slice(0, max);

/** A link or, with no safe address, nothing: the publish check asks for the address, a visitor never sees a dead link. */
function TextLink({ label, href, className = "", tone = "default" }: { label?: string; href?: string; className?: string; tone?: "default" | "light" }) {
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

// ---- Announcement strip ----------------------------------------------------------------------------------------

/** `source` "live" shows the server's line about the next public prickle (`live.text`, set per render by lib/landing/live-data.ts, never stored); without it, or when the load failed, the typed `text`. */
export type AnnouncementStripProps = {
  text: string;
  buttonLabel: string;
  href: string;
  tone: "gold" | "plum" | "charcoal";
  source?: "manual" | "live";
  /** Live, with no prickle coming up within a day: show nothing (default) or the typed text. */
  whenNone?: "hide" | "typed";
  live?: { text: string };
};
const STRIP_TONES = {
  gold: { band: "bg-gold text-gold-ink", dot: "bg-red-700", button: "bg-gold-ink text-gold" },
  plum: { band: "bg-plum-900 text-white", dot: "bg-gold", button: "bg-white text-plum-900" },
  charcoal: { band: "bg-cup text-white", dot: "bg-gold", button: "bg-gold text-gold-ink" },
} as const;

/** A bar above the page: a line of news with a pulsing dot and one button. High contrast on purpose; the dot only pulses when the visitor allows motion. */
export function AnnouncementStrip({ text: typed, buttonLabel, href, tone, source, whenNone, live }: AnnouncementStripProps) {
  const isLive = source === "live" && !!live;
  if (isLive && !live.text && whenNone !== "typed") return null;
  const text = isLive && live.text ? live.text : typed;
  if (!text && !buttonLabel) return null;
  const look = STRIP_TONES[tone] ?? STRIP_TONES.gold;
  const target = safeHref(href);
  const button = `rounded-full px-4 py-1.5 text-sm font-bold no-underline focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 ${look.button}`;
  return (
    <div className={`flex flex-wrap items-center justify-center gap-x-3 gap-y-2 px-4 py-3 text-center font-bold ${look.band}`}>
      {text && (
        <p className="flex items-center gap-2">
          <span aria-hidden="true" className={`landing-pulse inline-block h-2.5 w-2.5 shrink-0 rounded-full ${look.dot}`} />
          <span>{text}</span>
        </p>
      )}
      {buttonLabel &&
        (target ? (
          <a href={target} className={button}>
            {buttonLabel}
          </a>
        ) : (
          <span aria-disabled="true" className={`${button} opacity-50`}>
            {buttonLabel}
          </span>
        ))}
    </div>
  );
}

// ---- Schedule panel --------------------------------------------------------------------------------------------

export type ScheduleRow = { time: string; title: string; status: string; state: "live" | "soon" | "open"; host: string };
/** `source` "live" shows `live.rows` (the next public prickles, built per render on the server), or `emptyText` when there are none; the typed `rows` when there is no live data (never stored, see lib/landing/live-data.ts). */
export type SchedulePanelProps = {
  title: string;
  zoneLabel: string;
  rows: ScheduleRow[];
  source?: "manual" | "live";
  /** Live options, read on the server: how far ahead to look (hours), the most rows, and the host line ("none", or "experience" for "An experienced host"). */
  hoursAhead?: number;
  maxRows?: number;
  hostStyle?: "none" | "experience";
  /** Live: the line under a row with an experienced host (applied on the server, see `scheduleOptions`); default "An experienced host, sure to make you feel at home". */
  experiencedHostText?: string;
  /** The chip on a row that is neither running nor starting within the hour. Default none: a chip that is the same on most rows says nothing, so only "Live" and "In N min" show unless the owner asks for one. */
  openLabel?: string;
  /** One line under the whole list for what is true of every session (for example "Camera optional. Everyone is welcome."); default none. */
  footer?: string;
  /** An optional line under every row that has no host line of its own (for example "Camera optional"); default none. Never a name or a count. */
  rowNote?: string;
  emptyText?: string;
  live?: { rows: ScheduleRow[]; zoneLabel: string };
};
const DEFAULT_OPEN_LABEL = "";
const STATE_CHIP = { live: "bg-emerald-700 text-white", soon: "bg-gold text-gold-ink", open: "bg-mist-100 text-mist-900" } as const;

/** A panel of today's sessions, typed by hand: time, name, a status chip (live, soon, open) and an optional line about the host. A light panel in both themes, with its own text colours. */
export function SchedulePanel({ title, zoneLabel: typedZone, rows, source, emptyText, openLabel, rowNote, footer, live }: SchedulePanelProps) {
  const isLive = source === "live" && !!live;
  const list = rowsOf(isLive ? live.rows : rows, "title", 6);
  const zoneLabel = typedZone || (isLive ? live.zoneLabel : "");
  // Only a row that is running or starting soon carries a chip by default; an "open" chip appears only when the owner types a label for it.
  const open = openLabel ?? DEFAULT_OPEN_LABEL;
  if (list.length === 0 && !(isLive && emptyText)) return null;
  return (
    <section aria-label={title || "Schedule"} className="landing-light mx-auto max-w-xl overflow-hidden rounded-2xl bg-card text-left text-ink shadow-xl">
      {(title || zoneLabel) && (
        <div className="flex items-center justify-between gap-3 bg-mist-200 px-4 py-3 text-mist-950">
          <p className="font-bold">{title}</p>
          {zoneLabel && <p className="text-sm">{zoneLabel}</p>}
        </div>
      )}
      {list.length === 0 && <p className="px-4 py-4 text-ink">{emptyText}</p>}
      <ul>
        {list.map((row, i) => {
          const chip = row.status || (row.state === "open" || !row.state ? open : "");
          const note = row.host || rowNote || "";
          return (
            <li key={i} className={`grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 border-t border-mist-200 px-4 py-3 first:border-t-0 ${row.state === "live" ? "bg-emerald-50" : ""}`}>
              <span className="min-w-[5.5rem] whitespace-nowrap font-bold text-plum-800">{row.time}</span>
              <span className="font-semibold text-ink">{row.title}</span>
              {chip ? (
                <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-3 py-0.5 text-sm font-bold ${STATE_CHIP[row.state] ?? STATE_CHIP.open}`}>
                  {row.state === "live" && <span aria-hidden="true" className="landing-pulse inline-block h-2 w-2 rounded-full bg-white" />}
                  {chip}
                </span>
              ) : (
                <span aria-hidden="true" />
              )}
              {note && <p className="col-start-2 col-end-4 text-sm text-ink-muted">{note}</p>}
            </li>
          );
        })}
      </ul>
      {footer && <p className="border-t border-mist-200 px-4 py-3 text-sm text-ink-muted">{footer}</p>}
    </section>
  );
}

// ---- Outcome numbers -------------------------------------------------------------------------------------------

/**
 * An item is typed by hand, or (`source` "live") bound to a figure from the live registry (`stat`, lib/landing/live-stats.ts):
 * the server puts the formatted figure in `live` for one render and the typed `value` stays as the fallback. With a live
 * figure and no typed label, the figure's own caption is the label.
 */
export type OutcomeItem = { value: string; label: string; note: string; source?: "manual" | "live"; stat?: string; live?: { value: string; caption: string } };
export type OutcomeNumbersProps = { items: OutcomeItem[]; padding?: "none" | "small" | "medium" | "large"; showLiveNote?: boolean };
const OUTCOME_COLUMNS = ["", "", "@pair:grid-cols-2", "@pair:grid-cols-3", "@pair:grid-cols-2 @columns:grid-cols-4"] as const;

/** A full-width white band with a gold stripe on top: two to four big figures, typed by hand. Every colour is set here (plum numbers, dark ink labels), so nothing depends on the band it sits in. */
export function OutcomeNumbers({ items, padding, showLiveNote }: OutcomeNumbersProps) {
  const rows = (items ?? []).filter((i) => i && (i.value || i.live?.value)).slice(0, MAX.outcomes);
  if (rows.length === 0) return null;
  return (
    <section className={`landing-light border-t-8 border-gold bg-white text-ink ${pick(BAND_SPACE.figures, padding, "medium")}`}>
      <dl className={`mx-auto grid max-w-5xl gap-8 px-4 text-center ${OUTCOME_COLUMNS[Math.max(rows.length, 2)]}`}>
        {rows.map((row, i) => (
          <div key={i} className="flex flex-col-reverse">
            <dt className="mt-1 text-base font-semibold text-ink">
              {row.live ? row.label || row.live.caption : row.label}
              {row.note && <span className="ml-2 text-sm font-medium text-emerald-800">({row.note})</span>}
              {row.live && showLiveNote !== false && (
                <span className="ml-2 inline-flex items-center gap-1 text-sm font-medium text-emerald-800">
                  <span aria-hidden="true" className="landing-pulse inline-block h-2 w-2 rounded-full bg-emerald-700" />
                  live
                </span>
              )}
            </dt>
            <dd className="font-display text-5xl font-semibold leading-tight text-plum-900 @pair:text-6xl">{row.live ? row.live.value : row.value}</dd>
          </div>
        ))}
      </dl>
    </section>
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
const OFFER_STATUS = {
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

// ---- Coming up -------------------------------------------------------------------------------------------------

/**
 * One event or card. Typed cards (`items`) have the same shape the live ones do: `date` (YYYY-MM-DD, the first day, for the list's
 * date tile), `time` (the line under a list row's title; without it the row shows `when`), `soldOut` (shows the block's waitlist
 * link) and `imageAssetId` (a media library picture, made public on publish; live cards carry one only when the asset is already public).
 */
type ComingUpCardProps = {
  kind: string;
  title: string;
  when: string;
  availability: string;
  status?: OfferStatus | "";
  linkLabel: string;
  href: string;
  date?: string;
  time?: string;
  soldOut?: boolean;
  imageAssetId?: string;
};
/**
 * `source` "live" shows `live.cards` (the next events announced publicly, with real dates and places left, built per render on the
 * server and never stored: lib/landing/live-events.ts); without them, or when the load failed or nothing is coming up, the typed
 * `items`. `kinds` and `max` are live options read on the server (which kinds of event, and how many cards, up to 4). `more` is
 * one typed link under the cards (for example "See all events").
 *
 * `style` is how it is drawn: "cards" (the original, and what a block saved without `style` shows), "feature" (tall tiles with the
 * event's cover for big events, with a typed `waitlist` link for a sold-out one) or "list" (plain dated rows for routine sessions).
 */
export type ComingUpProps = {
  heading?: string;
  items: (ComingUpCardProps & { status: OfferStatus | "" })[];
  style?: "cards" | "feature" | "list";
  source?: "manual" | "live";
  kinds?: string[];
  max?: number;
  more?: { label: string; href: string };
  /** Feature style: the link a sold-out event shows (only when `href` is set; an empty label means the default). */
  waitlist?: { label: string; href: string };
  live?: { cards: ComingUpCardProps[] };
};
const COMING_COLUMNS = ["", "", "@pair:grid-cols-2", "@pair:grid-cols-2 @cards:grid-cols-3", "@pair:grid-cols-2 @columns:grid-cols-4"] as const;

export const WAITLIST_LABEL = "Join the waitlist";
const SOLD_OUT = "Sold out";
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** The day number and short month of a YYYY-MM-DD day, read from the text (no Date, so no zone can move it); null when it is not one. */
function dayTile(date: string | undefined): { day: number; month: string } | null {
  const match = /^\d{4}-(\d{2})-(\d{2})$/.exec(date ?? "");
  if (!match) return null;
  const month = Number(match[1]);
  const day = Number(match[2]);
  return month >= 1 && month <= 12 && day >= 1 && day <= 31 ? { day, month: MONTHS[month - 1] } : null;
}

/** The symbol for a kind of event, from the same table as the member Events page's placeholder art; typed cards name the kind in words. */
function kindSymbol(kind: string): string {
  const type = (Object.entries(COMING_UP_KIND_LABELS).find(([, label]) => label.toLowerCase() === kind.trim().toLowerCase())?.[0] ?? "other") as EventType;
  return eventArt(type).symbol;
}

/** The cards style: what the block has always drawn. */
function CardsStyle({ rows, ItemTitle }: { rows: ComingUpCardProps[]; ItemTitle: "h3" | "h4" }) {
  return (
    <ul className={`grid gap-4 ${COMING_COLUMNS[Math.max(rows.length, 2)]}`}>
      {rows.map((card, i) => {
        const status = card.status && card.status in OFFER_STATUS ? OFFER_STATUS[card.status] : null;
        return (
          <li key={i} className="flex flex-col gap-2 rounded-xl border-t-4 border-accent bg-card p-4 text-ink shadow-sm">
            <div className="flex flex-wrap gap-2">
              {card.kind && <span className="rounded-full bg-plum-100 px-3 py-0.5 text-sm font-semibold text-plum-900">{card.kind}</span>}
              {status && <span className={`rounded-full px-3 py-0.5 text-sm font-bold ${status.cls}`}>{status.label}</span>}
            </div>
            {/* A heading level below the block's own; without one the titles are the section's. */}
            <ItemTitle className="font-display text-xl font-semibold leading-tight">{card.title}</ItemTitle>
            {card.when && <p>{card.when}</p>}
            {card.availability && <p className="font-bold">{card.availability}</p>}
            <TextLink label={card.linkLabel} href={card.href} className="mt-auto pt-1" />
          </li>
        );
      })}
    </ul>
  );
}

/**
 * The feature style, for the big events: tall tiles. With a cover the picture is the tile and the words sit on a dark shade at the
 * bottom (white on it, readable on any picture); without one the tile is a plain blush or cream with the kind's symbol and dark words.
 * Never green, plum or brown. The picture is decorative (`alt=""`): the title is written on the tile beside it.
 */
function FeatureStyle({ rows, ItemTitle, waitlist }: { rows: ComingUpCardProps[]; ItemTitle: "h3" | "h4"; waitlist?: { label: string; href: string } }) {
  const waitlistHref = safeHref(waitlist?.href);
  return (
    // The block is its own container, so the tiles pair up by the room the block has, not the page: in half a column they stack.
    <div className="@container">
      <ul className="grid gap-4 @pair:grid-cols-2">
        {rows.map((card, i) => {
          const src = pageImage(card.imageAssetId, "event_card");
          const status = card.status && card.status in OFFER_STATUS ? OFFER_STATUS[card.status] : null;
          const soldOut = card.soldOut === true;
          const availability = card.availability || (soldOut ? SOLD_OUT : "");
          const onWaitlist = soldOut && !!waitlistHref;
          const label = onWaitlist ? waitlist?.label || WAITLIST_LABEL : card.linkLabel;
          const href = onWaitlist ? waitlistHref : card.href;
          return (
            <li key={i} className={`relative flex min-h-72 flex-col justify-end overflow-hidden rounded-2xl shadow-md ${src ? "bg-cup text-white" : `landing-light text-ink ${i % 2 === 0 ? "bg-blush" : "bg-cream"}`}`}>
              {src ? (
                <>
                  {/* eslint-disable-next-line @next/next/no-img-element -- served by the media route, already sized by its preset */}
                  <img src={src} alt="" loading="lazy" className="absolute inset-0 h-full w-full object-cover" />
                  <div aria-hidden="true" className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/65 to-black/5" />
                </>
              ) : (
                <span aria-hidden="true" className="absolute right-5 top-4 text-6xl opacity-80">
                  {kindSymbol(card.kind)}
                </span>
              )}
              <div className="relative flex flex-col items-start gap-2 p-5">
                <div className="flex flex-wrap gap-2">
                  {card.kind && <span className="rounded-full bg-white px-3 py-0.5 text-sm font-semibold text-plum-900">{card.kind}</span>}
                  {status && <span className={`rounded-full px-3 py-0.5 text-sm font-bold ${status.cls}`}>{status.label}</span>}
                </div>
                <ItemTitle className="font-display text-2xl font-semibold leading-tight">{card.title}</ItemTitle>
                {card.when && <p>{card.when}</p>}
                {availability && <p className="font-bold">{availability}</p>}
                <TextLink label={label} href={href} tone={src ? "light" : "default"} className="pt-1" />
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/**
 * The list style, for routine sessions: plain rows between thin rules, not cards. Each has a date tile (day over a short month, like a
 * calendar page; a real `<time>`), the title, the time with the kind as a quiet tag, and its link if it has one.
 */
function ListStyle({ rows, ItemTitle, live }: { rows: ComingUpCardProps[]; ItemTitle: "h3" | "h4"; live: boolean }) {
  return (
    <ul>
      {rows.map((card, i) => {
        const tile = dayTile(card.date);
        // A live event's `when` repeats the day the tile shows, so its line is `time`; a typed card falls back to its dates and place.
        const detail = live ? card.time : card.time || card.when;
        return (
          <li key={i} className="flex items-center gap-4 border-t border-ink-muted/30 py-3 first:border-t-0 first:pt-0">
            {tile && (
              <time dateTime={card.date} className="flex h-14 w-14 shrink-0 flex-col items-center justify-center rounded-lg bg-plum-100 leading-none text-plum-900">
                <span className="font-display text-2xl font-semibold">{tile.day}</span>
                <span className="mt-0.5 text-xs font-bold uppercase tracking-wider">{tile.month}</span>
              </time>
            )}
            <div className="min-w-0 flex-1">
              <ItemTitle className="font-semibold leading-snug">{card.title}</ItemTitle>
              {(detail || card.availability || card.kind) && (
                <p className="text-sm text-ink-muted">
                  {[detail, card.availability].filter(Boolean).join(" · ")}
                  {card.kind && <span className={`rounded-full border border-ink-muted/40 px-2 text-xs ${detail || card.availability ? "ml-2" : ""}`}>{card.kind}</span>}
                </p>
              )}
            </div>
            <TextLink label={card.linkLabel} href={card.href} className="shrink-0 text-sm" />
          </li>
        );
      })}
    </ul>
  );
}

/** Up to four events or cards for what is next, in one of three styles ("cards", "feature", "list"): see `ComingUpProps`. */
export function ComingUp({ heading: typedHeading, items, style, source, more, waitlist, live }: ComingUpProps) {
  const isLive = source === "live" && !!live && live.cards.length > 0;
  const rows: ComingUpCardProps[] = rowsOf(isLive ? live.cards : items, "title", MAX.comingUp);
  if (rows.length === 0) return null;
  const look = style === "feature" || style === "list" ? style : "cards";
  // A list says "Upcoming sessions" unless its heading is cleared on purpose; the others have none until one is typed.
  const heading = typedHeading ?? (look === "list" ? COMING_UP_LIST_HEADING : "");
  const ItemTitle = heading ? "h4" : "h3";
  return (
    <div className="py-4 text-left">
      {heading && <h3 className="mb-4 font-display text-2xl font-semibold leading-tight">{heading}</h3>}
      {look === "feature" ? <FeatureStyle rows={rows} ItemTitle={ItemTitle} waitlist={waitlist} /> : look === "list" ? <ListStyle rows={rows} ItemTitle={ItemTitle} live={isLive} /> : <CardsStyle rows={rows} ItemTitle={ItemTitle} />}
      {more?.label && safeHref(more.href) && (
        <p className={look === "list" ? "mt-4" : "mt-6 text-center"}>
          <TextLink label={more.label} href={more.href} />
          {look === "list" && <span aria-hidden="true"> →</span>}
        </p>
      )}
    </div>
  );
}
