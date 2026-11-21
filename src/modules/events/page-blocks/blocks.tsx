import { eventArt } from "@/components/EventArt";
import { itemList, type ItemProps, type Slot } from "@/components/landing/blocks";
import { OFFER_STATUS, rowsOf, TextLink, type OfferStatus } from "@/components/landing/homepage-blocks";
import type { EventType } from "@/lib/events-filter";
import { safeHref } from "@/lib/landing/data";
import { pageImage } from "@/components/landing/theme";
import { COMING_UP_KIND_LABELS, COMING_UP_LIST_HEADING } from "./live-kinds";

/**
 * The page blocks the events integration contributes: the Announcement strip and the Schedule panel (the next prickles, live
 * or typed) and Coming up (the next events). Static and presentational like every block (docs/product/LANDING_PAGES.md, "Homepage blocks");
 * their live values arrive in a render-only `live` prop that `live-loader.ts` sets per render on the server. Registered in `page-blocks.ts`.
 */

/** The most sessions a Schedule panel is laid out for (a number `CAP_CLASS` in src/components/landing/blocks.tsx has a class for). */
export const SCHEDULE_ITEM_LIMIT = 6;
/** The most cards a Coming up block draws. */
const COMING_UP_MAX_CARDS = 4;

// ---- Announcement strip ----------------------------------------------------------------------------------------

/** `source` "live" shows the server's line about the next public prickle (`live.text`, set per render by src/modules/events/page-blocks/live-loader.ts, never stored); without it, or when the load failed, the typed `text`. */
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
/**
 * `source` "live" shows `live.rows` (the next public prickles, built per render on the server), or `emptyText` when there are none;
 * the typed sessions (`items`, each a `ScheduleRow` block in the slot) when there is no live data (never stored, see src/modules/events/page-blocks/live-loader.ts).
 */
export type SchedulePanelProps = {
  title: string;
  zoneLabel: string;
  items: Slot;
  source?: "manual" | "live";
  /** Live options, read on the server: how far ahead to look (hours), the most rows, and the host line ("none", or "experience" for "An experienced host"). */
  hoursAhead?: number;
  maxRows?: number;
  hostStyle?: "none" | "experience";
  /** Live: the line under a row with an experienced host (applied on the server, see `scheduleOptions`); default "An experienced host, sure to make you feel at home". */
  experiencedHostText?: string;
  /** Live rows: the chip on a row that is neither running nor starting within the hour. Default none: a chip that is the same on most rows says nothing, so only "Live" and "In N min" show unless the owner asks for one. */
  openLabel?: string;
  /** One line under the whole list for what is true of every session (for example "Camera optional. Everyone is welcome."); default none. */
  footer?: string;
  /** Live rows: an optional line under every row that has no host line of its own (for example "Camera optional"); default none. Never a name or a count. A typed session carries its own line. */
  rowNote?: string;
  emptyText?: string;
  live?: { rows: ScheduleRow[]; zoneLabel: string };
  editing?: boolean;
};
const DEFAULT_OPEN_LABEL = "";
const STATE_CHIP = { live: "bg-emerald-700 text-white", soon: "bg-gold text-gold-ink", open: "bg-mist-100 text-mist-900" } as const;

/**
 * A panel of today's sessions: time, name, a status chip (live, soon, open) and an optional line about the host. Live, the rows are
 * drawn from the server's data; typed, they are the `ScheduleRow` blocks in the `items` slot (which drag on the canvas). A light panel in both themes, with its own text colours.
 */
export function SchedulePanel({ title, zoneLabel: typedZone, items: Items, source, emptyText, openLabel, rowNote, footer, live, editing }: SchedulePanelProps) {
  const isLive = source === "live" && !!live;
  const liveRows = isLive ? rowsOf(live.rows, "title", SCHEDULE_ITEM_LIMIT) : [];
  const zoneLabel = typedZone || (isLive ? live.zoneLabel : "");
  // Only a row that is running or starting soon carries a chip by default; an "open" chip appears only when the owner types a label for it.
  const open = openLabel ?? DEFAULT_OPEN_LABEL;
  if (isLive && liveRows.length === 0 && !emptyText) return null;
  return (
    // Typed, the panel does not know how many sessions its slot holds: with none (and none being edited) it is not drawn.
    <section aria-label={title || "Schedule"} className={`landing-light mx-auto max-w-xl overflow-hidden rounded-2xl bg-card text-left text-ink shadow-xl ${isLive || editing ? "" : "[&:not(:has(li))]:hidden"}`}>
      {(title || zoneLabel) && (
        <div className="flex items-center justify-between gap-3 bg-mist-200 px-4 py-3 text-mist-950">
          <p className="font-bold">{title}</p>
          {zoneLabel && <p className="text-sm">{zoneLabel}</p>}
        </div>
      )}
      {isLive && liveRows.length === 0 && <p className="px-4 py-4 text-ink">{emptyText}</p>}
      {isLive ? (
        <ul>
          {liveRows.map((row, i) => (
            <ScheduleRowItem key={i} {...row} openLabel={open} rowNote={rowNote} />
          ))}
        </ul>
      ) : (
        <Items as="ul" collisionAxis="y" className={itemList(SCHEDULE_ITEM_LIMIT, editing)} />
      )}
      {footer && <p className="border-t border-mist-200 px-4 py-3 text-sm text-ink-muted">{footer}</p>}
    </section>
  );
}

export type ScheduleRowItemProps = ScheduleRow & { openLabel?: string; rowNote?: string } & ItemProps;

/** One session of a Schedule panel. A typed one is a block of its own; a live one is drawn by the panel with the panel's chip and note settings. */
export function ScheduleRowItem({ time, title, status, state, host, openLabel, rowNote, dragRef, editing }: ScheduleRowItemProps) {
  if (!title && !editing) return null;
  const chip = status || (state === "open" || !state ? (openLabel ?? DEFAULT_OPEN_LABEL) : "");
  const note = host || rowNote || "";
  return (
    <li ref={dragRef} className={`grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 border-t border-mist-200 px-4 py-3 first:border-t-0 ${state === "live" ? "bg-emerald-50" : ""}`}>
      <span className="min-w-[5.5rem] whitespace-nowrap font-bold text-plum-800">{time}</span>
      <span className="font-semibold text-ink">{title}</span>
      {chip ? (
        <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-3 py-0.5 text-sm font-bold ${STATE_CHIP[state] ?? STATE_CHIP.open}`}>
          {state === "live" && <span aria-hidden="true" className="landing-pulse inline-block h-2 w-2 rounded-full bg-white" />}
          {chip}
        </span>
      ) : (
        <span aria-hidden="true" />
      )}
      {note && <p className="col-start-2 col-end-4 text-sm text-ink-muted">{note}</p>}
    </li>
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
 * server and never stored: src/modules/events/page-blocks/live-events.ts); without them, or when the load failed or nothing is coming up, the typed
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
  const rows: ComingUpCardProps[] = rowsOf(isLive ? live.cards : items, "title", COMING_UP_MAX_CARDS);
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
