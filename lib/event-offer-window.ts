import { ORG_TIMEZONE } from "@/lib/config";
import { resolveMatchDate } from "@/lib/kajabi-cohort-matching";

/** The days (inclusive, YYYY-MM-DD, Eastern) a purchase of a linked offer counts for the event; null = open end. */
export interface OfferWindow {
  purchased_from: string | null;
  purchased_until: string | null;
}

/** An offer linked to an event, with its purchase window. */
export interface EventOfferLink extends OfferWindow {
  kajabi_offer_id: string;
}

const dayFormat = new Intl.DateTimeFormat("en-CA", { timeZone: ORG_TIMEZONE, year: "numeric", month: "2-digit", day: "2-digit" });

/** The org-timezone calendar day (YYYY-MM-DD) of an instant; null when it isn't a date. */
export function orgDay(instant: string): string | null {
  const ms = new Date(instant).getTime();
  return Number.isNaN(ms) ? null : dayFormat.format(ms);
}

export function hasWindow(w: OfferWindow): boolean {
  return w.purchased_from !== null || w.purchased_until !== null;
}

/** Whether two windows share a day (a null end is open, so two open windows overlap). */
export function windowsOverlap(a: OfferWindow, b: OfferWindow): boolean {
  const aStartsBeforeBEnds = a.purchased_from === null || b.purchased_until === null || a.purchased_from <= b.purchased_until;
  const bStartsBeforeAEnds = b.purchased_from === null || a.purchased_until === null || b.purchased_from <= a.purchased_until;
  return aStartsBeforeBEnds && bStartsBeforeAEnds;
}

/**
 * Whether a purchase was made inside the window, by its Eastern day (never the server's zone).
 * A purchase with no usable date can't be placed, so it only counts for an open window.
 */
export function purchaseInWindow(purchase: { created_at_kajabi: string | null; effective_start_at?: string | null }, window: OfferWindow): boolean {
  if (!hasWindow(window)) return true;
  const raw = resolveMatchDate(purchase);
  const day = raw ? orgDay(raw) : null;
  if (!day) return false;
  return (window.purchased_from === null || day >= window.purchased_from) && (window.purchased_until === null || day <= window.purchased_until);
}

/** Whether a purchase counts for an event: it was bought on one of the event's linked offers, inside that link's window. */
export function purchaseCountsForEvent(
  purchase: { kajabi_offer_id: string | null; created_at_kajabi: string | null; effective_start_at?: string | null },
  links: EventOfferLink[]
): boolean {
  return links.some((l) => l.kajabi_offer_id === purchase.kajabi_offer_id && purchaseInWindow(purchase, l));
}

/** A day from a request: null for none (missing, null or ""), the YYYY-MM-DD string when it is a real day, undefined when invalid. */
export function parseWindowDay(value: unknown): string | null | undefined {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value ? value : undefined;
}

/** Reads a window from a request body; an error message when a day is invalid or the end is before the start. */
export function parseWindow(body: { purchasedFrom?: unknown; purchasedUntil?: unknown }): { window: OfferWindow } | { error: string } {
  const from = parseWindowDay(body.purchasedFrom);
  const until = parseWindowDay(body.purchasedUntil);
  if (from === undefined || until === undefined) return { error: "Purchase dates must be days like 2026-02-01" };
  if (from !== null && until !== null && until < from) return { error: "The last purchase day can't be before the first" };
  return { window: { purchased_from: from, purchased_until: until } };
}

/** What staff read when a link is refused. */
export function overlapMessage(reason: "overlap" | "single_event"): string {
  return reason === "overlap"
    ? "That offer is already linked to another event for purchases on overlapping days. Give each event its own dates."
    : "That offer is already linked to another event";
}
