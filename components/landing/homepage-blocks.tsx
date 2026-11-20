import { safeHref } from "@/lib/landing/data";
import { buttonClasses } from "./blocks";
import JourneyTabs from "./JourneyTabs";
import { BAND_SPACE, pageImage, pick } from "./theme";

/**
 * The homepage's blocks (docs/LANDING_PAGES.md, "Homepage blocks"). Static and presentational like the rest: no hooks (the Journey map's client part is `JourneyTabs.tsx`).
 * Typed by hand in the editor; the announcement strip, schedule panel and outcome numbers can be live ("Live data"):
 * they have a `source`, and the server hands them what they show in a render-only `live` prop (they never fetch). Layout is container queries with the named sizes, mobile first. Colours are theme tokens and fixed
 * brand colours only, and wherever a block sets its own background it also sets its own text colour, never inherits it.
 * Heading levels assume the page has a section heading (h2) above: titles inside a block are h3, and h4 under a block
 * heading, which lib/landing/a11y.ts mirrors. A link is a prop named `href` (cleaned on save), so a block with several
 * links keeps them in objects (`more`, `compare`, a stage's `link`).
 */

const MAX = { week: 7, finishers: 6, finishLines: 3, phases: 4, comingUp: 4, outcomes: 4, stages: 6, stageOffers: 4 } as const;

const rowsOf = <T extends object>(items: T[] | undefined, key: keyof T, max: number) => (items ?? []).filter((i) => i && i[key]).slice(0, max);

/** A link or, with no safe address, nothing: the publish check asks for the address, a visitor never sees a dead link. */
function TextLink({ label, href, className = "" }: { label?: string; href?: string; className?: string }) {
  const target = safeHref(href);
  if (!label || !target) return null;
  return (
    <a href={target} className={`font-semibold text-accent-ink underline underline-offset-4 hover:no-underline ${className}`}>
      {label}
    </a>
  );
}

/** A button as the Button block draws it (same classes, `safeHref`), shown disabled when it has no usable link. */
function LinkButton({ label, href, color = "plum", full = false }: { label?: string; href?: string; color?: "plum" | "light"; full?: boolean }) {
  if (!label) return null;
  const target = safeHref(href);
  const classes = buttonClasses("solid", color, "pill", full);
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

export type FinisherCardsProps = {
  items: { imageAssetId?: string; alt: string; name: string; kind: string; dayOne: string; theEnd: string; linkLabel: string; href: string }[];
  more: { label: string; href: string };
};

/** Photo-first cards in a book-cover shape: who, what she wrote, where she started (Day 1) and what she finished (THE END). With no picture, a soft placeholder, never an error. */
export function FinisherCards({ items, more }: FinisherCardsProps) {
  const rows = rowsOf(items, "name", MAX.finishers);
  if (rows.length === 0) return null;
  return (
    <div className="py-4">
      <ul className="grid grid-cols-2 gap-5 text-left @cards:grid-cols-3">
        {rows.map((card, i) => {
          const src = pageImage(card.imageAssetId, "event_card");
          return (
            <li key={i} className="flex flex-col gap-3">
              <div className="aspect-[3/4] overflow-hidden rounded-xl shadow-md">
                {src ? (
                  // eslint-disable-next-line @next/next/no-img-element -- served by the media route, already sized by its preset
                  <img src={src} alt={card.alt ?? ""} loading="lazy" className="h-full w-full object-cover" />
                ) : (
                  <div aria-hidden="true" className="flex h-full w-full items-center justify-center bg-gradient-to-br from-plum-200 to-plum-400 text-5xl">
                    📖
                  </div>
                )}
              </div>
              <div className="space-y-1">
                <h3 className="font-display text-xl font-semibold leading-tight">{card.name}</h3>
                {card.kind && <p className="text-sm">{card.kind}</p>}
                {card.dayOne && (
                  <p className="text-sm">
                    <span className="font-semibold">Day 1:</span> {card.dayOne}
                  </p>
                )}
                {card.theEnd && (
                  <p className="text-sm">
                    <span className="font-semibold">THE END:</span> {card.theEnd}
                  </p>
                )}
                <TextLink label={card.linkLabel} href={card.href} className="inline-block pt-1 text-sm" />
              </div>
            </li>
          );
        })}
      </ul>
      {more?.label && safeHref(more.href) && (
        <p className="mt-6 text-center">
          <TextLink label={more.label} href={more.href} />
        </p>
      )}
    </div>
  );
}

// ---- Timeline --------------------------------------------------------------------------------------------------

export type TimelineProps = { heading: string; intro: string; items: { when: string; title: string; text: string }[]; closing: string };

/** A vertical timeline: a line down the left with a dot for each moment (when, title, text), an optional heading and intro above and a closing line below. */
export function Timeline({ heading, intro, items, closing }: TimelineProps) {
  const rows = rowsOf(items, "title", 12);
  if (rows.length === 0 && !intro && !heading) return null;
  const ItemTitle = heading ? "h4" : "h3";
  return (
    <div className="mx-auto max-w-3xl py-4 text-left">
      {heading && <h3 className="font-display text-2xl font-semibold leading-tight">{heading}</h3>}
      {intro && <p className="mt-2 whitespace-pre-line text-lg">{intro}</p>}
      {rows.length > 0 && (
        <ol className="mt-6 ml-2 border-l-4 border-accent pl-6">
          {rows.map((row, i) => (
            <li key={i} className="relative pb-6 last:pb-0">
              <span aria-hidden="true" className="absolute -left-[2.1rem] top-1.5 h-3.5 w-3.5 rounded-full bg-accent" />
              {row.when && <p className="text-sm font-bold uppercase tracking-wide text-accent-ink">{row.when}</p>}
              <ItemTitle className="font-display text-xl font-semibold leading-tight">{row.title}</ItemTitle>
              {row.text && <p className="mt-1 whitespace-pre-line">{row.text}</p>}
            </li>
          ))}
        </ol>
      )}
      {closing && <p className="mt-8 border-l-4 border-gold pl-4 font-display text-xl italic">{closing}</p>}
    </div>
  );
}

// ---- Week strip ------------------------------------------------------------------------------------------------

export type WeekStripProps = { subtitle: string; items: { label: string; emoji: string; text: string; note: string }[] };
const WEEK_COLUMNS = [
  "",
  "",
  "grid-cols-2",
  "grid-cols-2 @cards:grid-cols-3",
  "grid-cols-2 @cards:grid-cols-4",
  "grid-cols-2 @cards:grid-cols-3 @columns:grid-cols-5",
  "grid-cols-2 @cards:grid-cols-3 @columns:grid-cols-6",
  "grid-cols-2 @cards:grid-cols-4 @columns:grid-cols-7",
] as const;

/** Up to seven day cards in a row (two columns on a narrow page): a label, an emoji, what happens and a small note. Cards on their own colours, so it reads apart from the schedule panel and the timeline. */
export function WeekStrip({ subtitle, items }: WeekStripProps) {
  const rows = rowsOf(items, "label", MAX.week);
  if (rows.length === 0) return null;
  return (
    <div className="py-4">
      {subtitle && <p className="mb-6 text-center text-lg">{subtitle}</p>}
      <ol className={`grid gap-3 ${WEEK_COLUMNS[Math.max(rows.length, 2)]}`}>
        {rows.map((day, i) => (
          <li key={i} className="flex flex-col items-center gap-1 rounded-xl border-b-4 border-accent bg-card p-3 text-center text-ink shadow-md">
            <p className="text-xs font-bold uppercase tracking-widest text-accent-ink">{day.label}</p>
            {day.emoji && (
              <span aria-hidden="true" className="text-3xl leading-none">
                {day.emoji}
              </span>
            )}
            {day.text && <p className="font-semibold">{day.text}</p>}
            {day.note && <p className="text-sm text-ink-muted">{day.note}</p>}
          </li>
        ))}
      </ol>
    </div>
  );
}

// ---- Finish-line cards -----------------------------------------------------------------------------------------

export type FinishLineCardsProps = { items: { title: string; program: string; text: string; durationLabel: string; durationPercent: number; buttonLabel: string; href: string }[] };
const FINISH_GRADIENTS = ["from-plum-700 to-plum-600", "from-brown-deep to-brown", "from-plum-950 to-plum-800"] as const;
const FINISH_COLUMNS = ["", "", "@split:grid-cols-2", "@split:grid-cols-2 @columns:grid-cols-3"] as const;
const percent = (value: unknown) => Math.min(100, Math.max(0, Math.round(Number(value) || 0)));

/** Two or three big gradient cards: a goal, the program behind it, a line, a duration bar with its label and one button. White text on the card's own gradient, whatever the section behind it. */
export function FinishLineCards({ items }: FinishLineCardsProps) {
  const rows = rowsOf(items, "title", MAX.finishLines);
  if (rows.length === 0) return null;
  return (
    <ul className={`grid gap-5 py-4 text-left ${FINISH_COLUMNS[Math.max(rows.length, 2)]}`}>
      {rows.map((card, i) => (
        <li key={i} className={`flex flex-col gap-3 rounded-2xl bg-gradient-to-br p-6 text-white shadow-lg ${FINISH_GRADIENTS[i % FINISH_GRADIENTS.length]}`}>
          <h3 className="font-display text-2xl font-semibold leading-tight">{card.title}</h3>
          {card.program && <p className="font-bold">{card.program}</p>}
          {card.text && <p>{card.text}</p>}
          {card.durationLabel && (
            <div>
              <p className="mb-1 text-right text-sm">{card.durationLabel}</p>
              <div aria-hidden="true" className="h-3.5 overflow-hidden rounded-full bg-white/25">
                <div className="h-full rounded-full bg-white" style={{ width: `${percent(card.durationPercent)}%` }} />
              </div>
            </div>
          )}
          <div className="mt-auto pt-2">
            <LinkButton label={card.buttonLabel} href={card.href} color="light" />
          </div>
        </li>
      ))}
    </ul>
  );
}

// ---- Plan phases -----------------------------------------------------------------------------------------------

export type PlanPhasesProps = { heading: string; items: { title: string; text: string }[] };
const PHASE_SHADES = ["bg-plum-100", "bg-plum-200", "bg-plum-300", "bg-plum-400"] as const;
const PHASE_COLUMNS = ["", "", "@pair:grid-cols-2", "@pair:grid-cols-3", "@pair:grid-cols-2 @columns:grid-cols-4"] as const;

/** Two to four phases of a plan, each a panel a shade deeper than the one before (light to deeper plum), with dark text set on every one. */
export function PlanPhases({ heading, items }: PlanPhasesProps) {
  const rows = rowsOf(items, "title", MAX.phases);
  if (rows.length === 0) return null;
  return (
    <div className="py-4 text-left">
      {heading && <h3 className="mb-4 font-display text-2xl font-semibold leading-tight">{heading}</h3>}
      <ol className={`grid overflow-hidden rounded-xl ${PHASE_COLUMNS[Math.max(rows.length, 2)]}`}>
        {rows.map((phase, i) => (
          <li key={i} className={`p-4 text-plum-950 ${PHASE_SHADES[i]}`}>
            <p className="font-bold">{phase.title}</p>
            {phase.text && <p className="mt-1">{phase.text}</p>}
          </li>
        ))}
      </ol>
    </div>
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

export type JourneyOffer = { status: OfferStatus; statusLabel: string; title: string; text: string; buttonLabel: string; href: string };
export type JourneyStage = { name: string; helps: string; current: boolean; note?: string; link?: { label: string; href: string }; offers?: JourneyOffer[] };
export type JourneyMapProps = {
  stages: JourneyStage[];
  compare: { label: string; href: string };
};
const OFFER_COLUMNS = ["", "", "@pair:grid-cols-2", "@pair:grid-cols-2 @cards:grid-cols-3", "@pair:grid-cols-2 @columns:grid-cols-4"] as const;

/** What one stage shows under the stepper: its offers as cards (side by side with room, stacked when narrow), or its note and link. */
function StagePanel({ stage }: { stage: JourneyStage }) {
  const offers = rowsOf(stage.offers, "title", MAX.stageOffers);
  if (offers.length === 0) {
    if (!stage.note && !(stage.link?.label && safeHref(stage.link.href))) return null;
    return (
      <div className="space-y-2 rounded-xl border-t-4 border-accent bg-card p-5 text-center text-ink shadow-md">
        {stage.note && <p className="font-semibold">{stage.note}</p>}
        <TextLink label={stage.link?.label} href={stage.link?.href} />
      </div>
    );
  }
  return (
    <ul className={`grid gap-4 ${OFFER_COLUMNS[offers.length]}`}>
      {offers.map((offer, i) => {
        const status = offerStatus(offer.status);
        return (
          <li key={i} className="flex flex-col gap-3 rounded-xl border-t-4 border-accent bg-card p-5 text-ink shadow-md">
            <span className={`self-start rounded-full px-3 py-0.5 text-sm font-bold ${status.cls}`}>{offer.statusLabel || status.label}</span>
            <h3 className="font-display text-2xl font-semibold leading-tight">{offer.title}</h3>
            {offer.text && <p>{offer.text}</p>}
            <div className="mt-auto pt-1">
              <LinkButton label={offer.buttonLabel} href={offer.href} />
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * Stages of a book as a connected stepper (a column on a narrow page, a row with room). Choosing a stage shows its programs
 * under it (`JourneyTabs`, the one client part); the stage marked `current` is the one chosen on load, the first without one.
 * Every panel is in the server's HTML. A "compare" link sits under the panel.
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

type ComingUpCardProps = { kind: string; title: string; when: string; availability: string; status?: OfferStatus | ""; linkLabel: string; href: string };
/**
 * `source` "live" shows `live.cards` (the next events announced publicly, with real dates and places left, built per render on the
 * server and never stored: lib/landing/live-events.ts); without them, or when the load failed or nothing is coming up, the typed
 * `items`. `kinds` and `max` are live options read on the server (which kinds of event, and how many cards, up to 4). `more` is
 * one typed link under the cards (for example "See all events").
 */
export type ComingUpProps = {
  heading: string;
  items: (ComingUpCardProps & { status: OfferStatus | "" })[];
  source?: "manual" | "live";
  kinds?: string[];
  max?: number;
  more?: { label: string; href: string };
  live?: { cards: ComingUpCardProps[] };
};
const COMING_COLUMNS = ["", "", "@pair:grid-cols-2", "@pair:grid-cols-2 @cards:grid-cols-3", "@pair:grid-cols-2 @columns:grid-cols-4"] as const;

/** Up to four cards for what is next (a retreat, a challenge): a kind pill, a title, dates or place, how many places are left, an optional status pill and link. */
export function ComingUp({ heading, items, source, more, live }: ComingUpProps) {
  const isLive = source === "live" && !!live && live.cards.length > 0;
  const rows: ComingUpCardProps[] = rowsOf(isLive ? live.cards : items, "title", MAX.comingUp);
  if (rows.length === 0) return null;
  return (
    <div className="py-4 text-left">
      {heading && <h3 className="mb-4 font-display text-2xl font-semibold leading-tight">{heading}</h3>}
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
              {heading ? <h4 className="font-display text-xl font-semibold leading-tight">{card.title}</h4> : <h3 className="font-display text-xl font-semibold leading-tight">{card.title}</h3>}
              {card.when && <p>{card.when}</p>}
              {card.availability && <p className="font-bold">{card.availability}</p>}
              <TextLink label={card.linkLabel} href={card.href} className="mt-auto pt-1" />
            </li>
          );
        })}
      </ul>
      {more?.label && safeHref(more.href) && (
        <p className="mt-6 text-center">
          <TextLink label={more.label} href={more.href} />
        </p>
      )}
    </div>
  );
}
