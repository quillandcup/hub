import { CONSENT_STORAGE_KEY } from "@/lib/analytics/consent";
import { clock } from "@/lib/clock";
import { CLOSED_KEY, SIGNED_UP_KEY, isQuiet, mayRemember, popupStorageKey, serializeClosure, serializeDismissal } from "@/lib/landing/exit-popup";

/**
 * The browser side of the exit popup's memory (docs/product/LANDING_PAGES.md, "Exit popup"): two site-wide records in the visitor's
 * own `localStorage`, read and written only here. Nothing is sent anywhere. Both are kept only where `mayKeepRecord` allows.
 */

function readStorage(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Blocked storage: the popup simply is not remembered.
  }
}

/** Whether this browser may keep the record: the page marks `<html data-consent-required>` where the banner asks (src/app/layout.tsx). */
export function mayKeepRecord(): boolean {
  return mayRemember(document.documentElement.hasAttribute("data-consent-required"), readStorage(CONSENT_STORAGE_KEY));
}

/** Whether a sign-up or a close, on this or any other page, keeps this popup away now. `slug` is this page's, for slice 1 records. */
export function isQuietHere(slug: string, rememberDays: number): boolean {
  return isQuiet({ signedUp: readStorage(SIGNED_UP_KEY), closed: readStorage(CLOSED_KEY), legacyPage: readStorage(popupStorageKey(slug)) }, clock.now(), rememberDays);
}

/** A sign-up through any opt-in form on a landing page: every exit popup on the site leaves this visitor alone for a year. */
export function rememberSignUp() {
  if (mayKeepRecord()) writeStorage(SIGNED_UP_KEY, serializeDismissal({ at: clock.now(), submitted: true }));
}

/** An exit popup was closed: every exit popup on the site stays away for `days` (0 keeps nothing: it may show on the next visit). */
export function rememberClose(days: number) {
  if (days > 0 && mayKeepRecord()) writeStorage(CLOSED_KEY, serializeClosure({ at: clock.now(), days }));
}
