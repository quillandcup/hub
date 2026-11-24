/**
 * The Exit popup block's settings and the rules for when it may show (docs/product/LANDING_PAGES.md, "Exit popup"). Pure, so the
 * trigger, the frequency cap and the "who never sees it" rules are tested without a browser; `src/components/landing/ExitPopup.tsx`
 * wires them to the page.
 *
 * Nothing here is sent anywhere. The only things remembered are two small records in the visitor's own browser: which sign-up forms
 * they have used (so no popup holding one of them asks again) and which popups they closed, each with its days (so that popup, and any
 * popup given the same name, stays away for a while). A different popup with a different form is not affected by either.
 */

export const POPUP_TRIGGERS = ["either", "exit", "time"] as const;
export type PopupTrigger = (typeof POPUP_TRIGGERS)[number];

export const DELAY_DEFAULT = 15;
export const DELAY_MIN = 1;
export const DELAY_MAX = 300;
export const REMEMBER_DEFAULT = 7;
export const REMEMBER_MAX = 365;
/** A visitor who signed up through a form is left alone, by every popup that holds that form, for this long. */
export const SUBMITTED_DAYS = 365;
/** Exit intent is not watched for in the first moments on the page: a flick of the mouse at arrival is not leaving. */
export const EXIT_ARM_MS = 3000;
/** When the time trigger fires while the visitor is typing, it waits and asks again after this long. */
export const TYPING_RETRY_MS = 3000;
const DAY_MS = 24 * 60 * 60 * 1000;

export type ExitPopupSettings = {
  enabled: boolean;
  trigger: PopupTrigger;
  delaySeconds: number;
  /** Days this popup stays away after it is closed (on every page that gives popups the same name); 0 means it may show again on the next visit (it still shows once per page load). */
  rememberDays: number;
  /** Popups on different pages with the same name share what is remembered about a close; empty means this page's popup only. */
  popupName: string;
  closeOnOverlay: boolean;
  hideOnDesktop: boolean;
  hideOnMobile: boolean;
  /** The name a screen reader gives the dialog. */
  label: string;
};

const num = (value: unknown, min: number, max: number, fallback: number): number => {
  const n = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : NaN;
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : fallback;
};

export const POPUP_NAME_MAX = 60;

/** A popup's name as compared: trimmed, spaces collapsed, lower case ("Newsletter " and "newsletter" are one popup). */
export function normalizePopupName(value: unknown): string {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ").toLowerCase().slice(0, POPUP_NAME_MAX) : "";
}

/** The popup's settings as stored (untrusted JSON: a missing, wrong or out-of-range value takes the default or the nearest allowed one). */
export function normalizeExitPopup(props: Record<string, unknown>): ExitPopupSettings {
  const label = typeof props.label === "string" ? props.label.trim().slice(0, 120) : "";
  return {
    enabled: props.enabled === true,
    trigger: POPUP_TRIGGERS.find((t) => t === props.trigger) ?? "either",
    delaySeconds: num(props.delaySeconds, DELAY_MIN, DELAY_MAX, DELAY_DEFAULT),
    rememberDays: num(props.rememberDays, 0, REMEMBER_MAX, REMEMBER_DEFAULT),
    popupName: normalizePopupName(props.popupName),
    closeOnOverlay: props.closeOnOverlay !== false,
    hideOnDesktop: props.hideOnDesktop === true,
    hideOnMobile: props.hideOnMobile === true,
    label,
  };
}

/** What the visitor's device can do, read in the browser. `mobile` is a narrow window (the layout's own switch point); `finePointer` is a mouse or trackpad that can leave the page through the top edge. */
export type PopupDevice = { mobile: boolean; finePointer: boolean };
export type PopupTriggers = { time: boolean; exit: boolean };

/**
 * Which triggers to watch on this device, or null when the popup must not show here. Exit intent needs a mouse, so a phone or a
 * tablet only ever gets the time trigger (a popup set to "when they try to leave" alone never shows on one: there is no signal that
 * is reliable enough, and the back button and scroll-up guesses are a nuisance, not a feature).
 */
export function planTriggers(settings: ExitPopupSettings, device: PopupDevice): PopupTriggers | null {
  if (!settings.enabled) return null;
  if (device.mobile ? settings.hideOnMobile : settings.hideOnDesktop) return null;
  const time = settings.trigger !== "exit";
  const exit = settings.trigger !== "time" && device.finePointer;
  return time || exit ? { time, exit } : null;
}

/** The mouse left the page through the top edge: toward the tabs, the address bar or the close button. */
export function isExitIntent(event: { clientY: number; relatedTarget: unknown }): boolean {
  return event.relatedTarget === null && event.clientY <= 0;
}

/** A sign-in cookie is present, so this is a signed-in member (or staff): the public page never shows them a sign-up popup. It reads the cookie's name only, never its value. */
export function hasSignInCookie(cookie: string): boolean {
  return /(?:^|;\s*)sb-[^=;\s]+-auth-token(?:\.\d+)?=/.test(cookie);
}

/**
 * Whether this browser may keep the one small record. Where the consent banner asks (the EU, EEA, UK and anywhere we can't tell) that
 * is only after an Accept; elsewhere it is allowed. Without it the popup is shown at most once per page load and nothing is stored.
 */
export function mayRemember(consentRequired: boolean, consent: string | null): boolean {
  return !consentRequired || consent === "granted";
}

/** A slice 1 per-page record: `at` is when the popup was closed (ms), `submitted` whether the visitor signed up. */
export type Dismissal = { at: number; submitted: boolean };
/** The record of a close: when (ms) and the days that popup asked for, so a later close overwrites it. */
export type Closure = { at: number; days: number };

/** Sign-ups: `{ [form id]: when (ms) }`. Set by a sign-up through an opt-in form on a landing page. */
export const SIGNED_UP_KEY = "lp-popup-site:signed-up";
/** Closes: `{ [popup key]: { at, days } }`. Set when an exit popup is closed. */
export const CLOSED_KEY = "lp-popup-site:closed";
/** Slice 1 kept a record per page under this key; it is still read (never written or deleted) so those visitors stay left alone on that page. */
export const popupStorageKey = (slug: string) => `lp-popup:${slug}`;
/** The most entries each site-wide record keeps; the oldest go first. */
const MEMORY_MAX = 50;

/** What a close is remembered under: the popup's name when it has one (shared by every page that uses it), else this page. */
export const popupKey = (popupName: string, slug: string): string => (popupName ? `name:${popupName}` : `page:${slug}`);

/** Form ids as the page's data holds them (untrusted): only the plain ones the relay would accept. */
export function normalizeFormIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const ids = value.filter((v): v is string => typeof v === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(v));
  return [...new Set(ids)].slice(0, 20);
}

type Node = { type?: unknown; props?: Record<string, unknown> };

function collectFormIds(content: unknown, into: Set<string>) {
  if (!Array.isArray(content)) return;
  for (const raw of content) {
    if (!raw || typeof raw !== "object") continue;
    const node = raw as Node;
    if (node.type === "OptInForm" && typeof node.props?.kajabiFormId === "string" && node.props.kajabiFormId.trim()) into.add(node.props.kajabiFormId.trim());
    for (const value of Object.values(node.props ?? {})) collectFormIds(value, into);
  }
}

/**
 * Gives each exit popup in a page's data the ids of the sign-up forms inside it (`formIds`), so the browser knows which sign-ups
 * mean "this popup has done its job" without the popup's blocks being in the page's HTML. Done on the server before the page is
 * drawn; the data is not changed in place.
 */
export function withPopupFormIds<T>(data: T): T {
  const visit = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(visit);
    if (!value || typeof value !== "object") return value;
    const node = value as Node;
    const props = node.props && typeof node.props === "object" ? Object.fromEntries(Object.entries(node.props).map(([k, v]) => [k, visit(v)])) : node.props;
    if (node.type === "ExitPopup" && props) {
      const ids = new Set<string>();
      collectFormIds(props.content, ids);
      return { ...node, props: { ...props, formIds: [...ids] } };
    }
    return node.props ? { ...node, props } : Object.fromEntries(Object.entries(node).map(([k, v]) => [k, visit(v)]));
  };
  return visit(data) as T;
}

export function parseDismissal(raw: string | null): Dismissal | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as unknown;
    if (!value || typeof value !== "object") return null;
    const { at, submitted } = value as Record<string, unknown>;
    return typeof at === "number" && Number.isFinite(at) ? { at, submitted: submitted === true } : null;
  } catch {
    return null;
  }
}

export const serializeDismissal = (record: Dismissal): string => JSON.stringify({ at: record.at, submitted: record.submitted });

function parseMap(raw: string | null): Record<string, unknown> {
  if (!raw) return {};
  try {
    const value = JSON.parse(raw) as unknown;
    return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

const finite = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);

/** The forms signed up through, and when. Anything that is not `{ id: number }` is dropped. */
export function parseSignedUp(raw: string | null): Map<string, number> {
  return new Map(Object.entries(parseMap(raw)).filter((e): e is [string, number] => finite(e[1])));
}

/** The popups closed, and when and for how many days. Anything that is not `{ at, days }` is dropped. */
export function parseClosures(raw: string | null): Map<string, Closure> {
  const out = new Map<string, Closure>();
  for (const [key, value] of Object.entries(parseMap(raw))) {
    const { at, days } = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
    if (finite(at) && finite(days)) out.set(key, { at, days });
  }
  return out;
}

const newest = <T>(entries: [string, T][], at: (v: T) => number): [string, T][] => entries.sort((x, y) => at(y[1]) - at(x[1])).slice(0, MEMORY_MAX);

/** The sign-up record with this form added (an earlier sign-up through it is replaced), and the ones that no longer matter dropped. */
export function addSignUp(raw: string | null, formId: string, now: number): string {
  const kept = [...parseSignedUp(raw)].filter(([id, at]) => id !== formId && at <= now && now - at < SUBMITTED_DAYS * DAY_MS);
  return JSON.stringify(Object.fromEntries(newest([...kept, [formId, now] as [string, number]], (at) => at)));
}

/** The close record with this popup's close added (a later close replaces the earlier), and the ones that no longer matter dropped. */
export function addClosure(raw: string | null, key: string, closure: Closure, now: number): string {
  const kept = [...parseClosures(raw)].filter(([k, c]) => k !== key && c.at <= now && now - c.at < c.days * DAY_MS);
  return JSON.stringify(Object.fromEntries(newest([...kept, [key, closure] as [string, Closure]], (c) => c.at)));
}

/** Whether a slice 1 per-page record keeps the popup away at `now`. A record dated in the future (a changed clock) does not. */
export function isSuppressed(record: Dismissal | null, now: number, rememberDays: number): boolean {
  if (!record || record.at > now) return false;
  const days = record.submitted ? SUBMITTED_DAYS : rememberDays;
  return days > 0 && now - record.at < days * DAY_MS;
}

/** What this browser remembers (raw stored text): the sign-ups, the closes and, for the page being viewed, the slice 1 per-page record. */
export type PopupMemory = { signedUp: string | null; closed: string | null; legacyPage: string | null };
/** Which popup is asking: its key (`popupKey`) and the ids of the sign-up forms it holds. */
export type PopupIdentity = { key: string; formIds: string[] };

/**
 * Whether anything remembered keeps this popup away at `now`: a sign-up through a form this popup holds (a year; a popup with no
 * form is never affected by sign-ups), a close of this popup or of one with the same name (for the days stored with that close, not
 * this popup's own), or a slice 1 record for this page (as before). A record dated in the future (a changed clock) does not count.
 */
export function isQuiet(memory: PopupMemory, popup: PopupIdentity, now: number, rememberDays: number): boolean {
  const signedUp = parseSignedUp(memory.signedUp);
  for (const id of popup.formIds) {
    const at = signedUp.get(id);
    if (at !== undefined && isSuppressed({ at, submitted: true }, now, rememberDays)) return true;
  }
  const closed = parseClosures(memory.closed).get(popup.key);
  if (closed && closed.at <= now && closed.days > 0 && now - closed.at < closed.days * DAY_MS) return true;
  return isSuppressed(parseDismissal(memory.legacyPage), now, rememberDays);
}

/** What the settings mean, in a sentence for the editor's canvas ("Shows after 15 seconds, or when a visitor on a computer goes to leave. ..."). */
export function describeExitPopup(settings: ExitPopupSettings): string {
  const when =
    settings.trigger === "time"
      ? `after ${settings.delaySeconds} seconds`
      : settings.trigger === "exit"
        ? "when a visitor on a computer goes to leave (never on a phone)"
        : `after ${settings.delaySeconds} seconds, or when a visitor on a computer goes to leave`;
  const where = settings.hideOnDesktop && settings.hideOnMobile ? " Hidden on every device." : settings.hideOnDesktop ? " Hidden on desktop." : settings.hideOnMobile ? " Hidden on mobile." : "";
  const again = settings.rememberDays === 0 ? "Shows again on every visit." : `Not shown again for ${settings.rememberDays} ${settings.rememberDays === 1 ? "day" : "days"} after it is closed${settings.popupName ? ` (on every page with a popup named \u201c${settings.popupName}\u201d)` : ""}.`;
  return `Shows ${when}.${where} ${again}`;
}

/** Fired on `window` by a sign-up form when it succeeds, so a popup on the same page stops asking (the form in the popup, or any form on the page). */
export const OPT_IN_DONE_EVENT = "landing-opt-in-done";

/** The page's address on the public site (`/p/<slug>`), or null in the editor and the preview, which are not the public page. */
export function publicSlugOf(pathname: string): string | null {
  const match = /^\/p\/([A-Za-z0-9-]+)\/?$/.exec(pathname);
  return match ? match[1] : null;
}
