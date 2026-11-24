import { CONSENT_STORAGE_KEY } from "@/lib/analytics/consent";
import { clock } from "@/lib/clock";
import { CLOSED_KEY, SIGNED_UP_KEY, addClosure, addSignUp, isQuiet, mayRemember, popupStorageKey, type PopupIdentity } from "@/lib/landing/exit-popup";

/**
 * The browser side of the exit popup's memory (docs/product/LANDING_PAGES.md, "Exit popup"): two records in the visitor's
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

/** Whether a sign-up through one of the popup's forms, or a close of it (or of a popup with its name), keeps it away now. `slug` is this page's, for slice 1 records. */
export function isQuietHere(slug: string, popup: PopupIdentity, rememberDays: number): boolean {
  return isQuiet({ signedUp: readStorage(SIGNED_UP_KEY), closed: readStorage(CLOSED_KEY), legacyPage: readStorage(popupStorageKey(slug)) }, popup, clock.now(), rememberDays);
}

/** A sign-up through an opt-in form: every popup that holds this form leaves this visitor alone for a year. Popups with other forms are not affected. */
export function rememberSignUp(formId: string) {
  if (formId && mayKeepRecord()) writeStorage(SIGNED_UP_KEY, addSignUp(readStorage(SIGNED_UP_KEY), formId, clock.now()));
}

/** A popup was closed: it, and any popup with the same name, stays away for `days` (0 keeps nothing: it may show on the next visit). */
export function rememberClose(popup: PopupIdentity, days: number) {
  if (days > 0 && mayKeepRecord()) writeStorage(CLOSED_KEY, addClosure(readStorage(CLOSED_KEY), popup.key, { at: clock.now(), days }, clock.now()));
}
