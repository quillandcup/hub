/**
 * The Exit popup block's settings and the rules for when it may show (docs/product/LANDING_PAGES.md, "Exit popup"). Pure, so the
 * trigger, the frequency cap and the "who never sees it" rules are tested without a browser; `src/components/landing/ExitPopup.tsx`
 * wires them to the page.
 *
 * Nothing here is sent anywhere. The only things remembered are two small records in the visitor's own browser, site-wide and not per
 * page: when they last closed an exit popup and for how many days, and when they signed up, so no popup is shown again for a while.
 */

export const POPUP_TRIGGERS = ["either", "exit", "time"] as const;
export type PopupTrigger = (typeof POPUP_TRIGGERS)[number];

export const DELAY_DEFAULT = 15;
export const DELAY_MIN = 1;
export const DELAY_MAX = 300;
export const REMEMBER_DEFAULT = 7;
export const REMEMBER_MAX = 365;
/** A visitor who signed up through any sign-up form on any landing page is left alone, by every exit popup on the site, for this long. */
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
  /** Days every exit popup on the site stays away after this one is closed; 0 means it may show again on the next visit (it still shows once per page load). */
  rememberDays: number;
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

/** The popup's settings as stored (untrusted JSON: a missing, wrong or out-of-range value takes the default or the nearest allowed one). */
export function normalizeExitPopup(props: Record<string, unknown>): ExitPopupSettings {
  const label = typeof props.label === "string" ? props.label.trim().slice(0, 120) : "";
  return {
    enabled: props.enabled === true,
    trigger: POPUP_TRIGGERS.find((t) => t === props.trigger) ?? "either",
    delaySeconds: num(props.delaySeconds, DELAY_MIN, DELAY_MAX, DELAY_DEFAULT),
    rememberDays: num(props.rememberDays, 0, REMEMBER_MAX, REMEMBER_DEFAULT),
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

/** A record of a sign-up (`submitted: true`) or a slice 1 per-page record: `at` is when (ms). */
export type Dismissal = { at: number; submitted: boolean };
/** The site-wide record of a close: when (ms) and the days that popup asked for, so a later close overwrites it. */
export type Closure = { at: number; days: number };

/** Site-wide: set by a sign-up through any opt-in form on any landing page. */
export const SIGNED_UP_KEY = "lp-popup-site:signed-up";
/** Site-wide: set when any exit popup is closed. */
export const CLOSED_KEY = "lp-popup-site:closed";
/** Slice 1 kept a record per page under this key; it is still read (never written or deleted) so those visitors stay left alone on that page. */
export const popupStorageKey = (slug: string) => `lp-popup:${slug}`;

export function parseClosure(raw: string | null): Closure | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as unknown;
    if (!value || typeof value !== "object") return null;
    const { at, days } = value as Record<string, unknown>;
    return typeof at === "number" && Number.isFinite(at) && typeof days === "number" && Number.isFinite(days) ? { at, days } : null;
  } catch {
    return null;
  }
}

export const serializeClosure = (record: Closure): string => JSON.stringify({ at: record.at, days: record.days });

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

/** Whether a sign-up or slice 1 per-page record keeps the popup away at `now`. A record dated in the future (a changed clock) does not. */
export function isSuppressed(record: Dismissal | null, now: number, rememberDays: number): boolean {
  if (!record || record.at > now) return false;
  const days = record.submitted ? SUBMITTED_DAYS : rememberDays;
  return days > 0 && now - record.at < days * DAY_MS;
}

/** What this browser remembers (raw stored text): the two site-wide records and, for the page being viewed, the slice 1 per-page one. */
export type PopupMemory = { signedUp: string | null; closed: string | null; legacyPage: string | null };

/**
 * Whether any record keeps the popup away at `now`: a sign-up anywhere on the site (a year), a close of any exit popup on the site
 * (for the days that popup asked for, as stored, not this popup's own), or a slice 1 record for this page (as before). A record dated
 * in the future (a changed clock) does not count.
 */
export function isQuiet(memory: PopupMemory, now: number, rememberDays: number): boolean {
  const signedUp = parseDismissal(memory.signedUp);
  if (signedUp && isSuppressed({ at: signedUp.at, submitted: true }, now, rememberDays)) return true;
  const closed = parseClosure(memory.closed);
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
  const again = settings.rememberDays === 0 ? "Shows again on every visit." : `No exit popup on the site is shown again for ${settings.rememberDays} ${settings.rememberDays === 1 ? "day" : "days"} after it is closed.`;
  return `Shows ${when}.${where} ${again}`;
}

/** Fired on `window` by a sign-up form when it succeeds, so a popup on the same page stops asking (the form in the popup, or any form on the page). */
export const OPT_IN_DONE_EVENT = "landing-opt-in-done";

/** The page's address on the public site (`/p/<slug>`), or null in the editor and the preview, which are not the public page. */
export function publicSlugOf(pathname: string): string | null {
  const match = /^\/p\/([A-Za-z0-9-]+)\/?$/.exec(pathname);
  return match ? match[1] : null;
}
