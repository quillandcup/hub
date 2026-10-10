"use client";

import { useEffect, useState } from "react";

const DISMISSED_KEY = "install-app-prompt-dismissed";

/** iPhone/iPad in a normal browser tab, not installed to the home screen. Any iOS browser counts: they all use WebKit. */
export function isIosBrowserTab(): boolean {
  const ua = navigator.userAgent;
  // iPadOS 13+ reports itself as a Mac, but a Mac has no touch points.
  const ios = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const installed =
    (navigator as Navigator & { standalone?: boolean }).standalone === true ||
    window.matchMedia?.("(display-mode: standalone)")?.matches === true;
  return ios && !installed;
}

/**
 * Where the Share button is, for this device and browser. Every iOS browser can add to the Home
 * Screen from its Share menu, but the button sits in different places.
 */
export function shareButtonLocation(ua: string, isIpad: boolean): string {
  if (/CriOS|FxiOS|EdgiOS/.test(ua)) return "Tap the Share button next to the address bar";
  return isIpad ? "Tap the Share button at the top of the window" : "Tap the Share button in the bottom toolbar";
}

function isIpadDevice(): boolean {
  return /iPad/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

/**
 * The steps to add the Hub to the Home Screen, for this device and browser, with a button that opens
 * the system share sheet where the browser supports it. Shared by the banner and the settings page.
 */
export function InstallSteps() {
  const [where, setWhere] = useState("Tap the Share button");
  const [canShare, setCanShare] = useState(false);

  useEffect(() => {
    setWhere(shareButtonLocation(navigator.userAgent, isIpadDevice()));
    setCanShare(typeof navigator.share === "function");
  }, []);

  // No link or API opens "Add to Home Screen" itself; this opens the system share sheet, which lists it.
  const openShareMenu = () => {
    navigator.share({ title: document.title, url: window.location.href }).catch(() => {
      // Cancelled, or not allowed here: the steps still apply.
    });
  };

  return (
    <>
      <p className="mt-0.5">
        On iPhone and iPad, notifications for prickle check-ins and more only work from the installed app. {where},
        choose <strong>Add to Home Screen</strong>, then open the Hub from there and turn notifications on in
        Settings → Notifications.
      </p>
      {canShare && (
        <button
          type="button"
          onClick={openShareMenu}
          className="mt-2 rounded-md border border-plum-300 px-3 py-1.5 font-medium hover:bg-plum-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-plum-500 dark:border-plum-700 dark:hover:bg-plum-900"
        >
          Open the Share menu
        </button>
      )}
    </>
  );
}

/**
 * On iOS, web push only works from the Hub installed to the home screen, so a member browsing in a
 * normal tab is nudged to install it, with the benefit up front. Shown only to members who have the
 * browser_notifications flag (app/(member)/layout.tsx); dismissing it is remembered on this device
 * (Settings → Notifications still shows the steps).
 */
export function InstallAppPrompt() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    let dismissed = false;
    try {
      dismissed = localStorage.getItem(DISMISSED_KEY) === "1";
    } catch {
      // Storage blocked: show it every visit rather than never.
    }
    setShow(!dismissed && isIosBrowserTab());
  }, []);

  if (!show) return null;

  const dismiss = () => {
    try {
      localStorage.setItem(DISMISSED_KEY, "1");
    } catch {
      // Dismissed for this visit only.
    }
    setShow(false);
  };

  return (
    <section
      aria-label="Install the Hub"
      className="flex items-start gap-3 border-b border-plum-200 bg-plum-50 px-4 py-3 text-sm text-plum-900 dark:border-plum-900 dark:bg-plum-950 dark:text-plum-100"
    >
      <div className="min-w-0 flex-1">
        <div className="font-medium">Add the Hub to your Home Screen to get notifications</div>
        <InstallSteps />
      </div>
      <button
        type="button"
        onClick={dismiss}
        className="shrink-0 rounded-md px-2 py-1 font-medium hover:bg-plum-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-plum-500 dark:hover:bg-plum-900"
      >
        Not now
      </button>
    </section>
  );
}
