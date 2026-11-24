"use client";

import { lazy, Suspense, useEffect, useRef, useState, type ReactNode } from "react";
import { CONSENT_STORAGE_KEY } from "@/lib/analytics/consent";
import { clock } from "@/lib/clock";
import {
  EXIT_ARM_MS,
  OPT_IN_DONE_EVENT,
  TYPING_RETRY_MS,
  hasSignInCookie,
  isExitIntent,
  isSuppressed,
  mayRemember,
  parseDismissal,
  planTriggers,
  popupStorageKey,
  publicSlugOf,
  serializeDismissal,
  type ExitPopupSettings,
} from "@/lib/landing/exit-popup";

/**
 * The part of an Exit popup that runs on the public page (docs/product/LANDING_PAGES.md, "Exit popup"): it watches for the moment to
 * show the popup and draws nothing until then (a hidden, empty anchor: no layout shift, and the popup's blocks are not in the page's
 * HTML). The window itself, with its focus handling, is a separate chunk (ExitPopupDialog.tsx), fetched when the page is idle so
 * that it is there at the moment of showing, and not before.
 *
 * Who never sees it: a signed-in member or staff (a sign-in cookie), anyone who closed it within the page's "days to leave alone" or
 * signed up (any sign-up form on the page), and anyone whose device the settings hide it on. The editor and the admin preview
 * (an address other than `/p/<page>`) ignore the signed-in and "closed before" rules, so staff can see it, and never keep anything.
 *
 * What is remembered: one small record in the visitor's own browser, `{ at, submitted }`, and only where the consent banner does not
 * ask or has been accepted (`mayRemember`). Without that the popup shows at most once per page load. Nothing is sent anywhere.
 */

const ExitPopupDialog = lazy(() => import("./ExitPopupDialog"));

export type ExitPopupProps = Pick<ExitPopupSettings, "trigger" | "delaySeconds" | "rememberDays" | "closeOnOverlay" | "hideOnDesktop" | "hideOnMobile" | "label"> & {
  /** The box's width and background classes (`popupBoxClasses`). */
  boxClass: string;
  /** The popup's blocks, drawn on the server and shown only when the popup opens. */
  children: ReactNode;
};

const matches = (query: string) => typeof window.matchMedia === "function" && window.matchMedia(query).matches;

function isTyping(): boolean {
  const el = document.activeElement;
  return el instanceof HTMLElement && (el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName));
}

/** The page frame's style tokens (`lp-*`, `landing-light`), so the popup, drawn on `<body>`, looks like the page. */
function frameClassOf(anchor: Element | null): string {
  const frame = anchor?.closest("[data-lp-frame]");
  return (frame?.getAttribute("class") ?? "").split(/\s+/).filter((c) => c.startsWith("lp-") || c === "landing-light").join(" ");
}

function readStorage(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

/** Whether this browser may keep the record: the page marks `<html data-consent-required>` where the banner asks (src/app/layout.tsx). */
function mayKeepRecord(): boolean {
  return mayRemember(document.documentElement.hasAttribute("data-consent-required"), readStorage(CONSENT_STORAGE_KEY));
}

export default function ExitPopup({ trigger, delaySeconds, rememberDays, closeOnOverlay, hideOnDesktop, hideOnMobile, label, boxClass, children }: ExitPopupProps) {
  const anchor = useRef<HTMLSpanElement>(null);
  const [open, setOpen] = useState(false);
  const [frameClass, setFrameClass] = useState("");
  /** The page's address and whether this is the real page; set by the effect, read by `close`. */
  const page = useRef<{ slug: string | null }>({ slug: null });

  useEffect(() => {
    const slug = publicSlugOf(window.location.pathname);
    page.current = { slug };
    // The real page is anonymous and cached, so who is signed in is known only here, from the cookie's name.
    if (slug !== null) {
      if (hasSignInCookie(document.cookie)) return;
      if (isSuppressed(parseDismissal(readStorage(popupStorageKey(slug))), clock.now(), rememberDays)) return;
    }
    const plan = planTriggers(
      { enabled: true, trigger, delaySeconds, rememberDays, closeOnOverlay, hideOnDesktop, hideOnMobile, label },
      { mobile: !matches("(min-width: 48rem)"), finePointer: matches("(hover: hover) and (pointer: fine)") },
    );
    if (!plan) return;

    let finished = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let armTimer: ReturnType<typeof setTimeout> | undefined;
    // Fetch the window's code when the page is idle, so it is ready at the moment of showing.
    const idle = setTimeout(() => void import("./ExitPopupDialog"), 1500);
    const onLeave = (event: MouseEvent) => {
      if (isExitIntent(event)) show();
    };
    const stop = () => {
      finished = true;
      clearTimeout(timer);
      clearTimeout(armTimer);
      clearTimeout(idle);
      document.removeEventListener("mouseout", onLeave);
    };
    function show() {
      if (finished) return;
      stop();
      setFrameClass(frameClassOf(anchor.current));
      setOpen(true);
    }
    const tryTime = () => {
      if (finished) return;
      // Not while they are typing in a field of the page, and not in a tab nobody is looking at.
      if (isTyping() || document.visibilityState === "hidden") timer = setTimeout(tryTime, TYPING_RETRY_MS);
      else show();
    };
    // A sign-up anywhere on the page ends it: no popup after the visitor has signed up.
    const onSignedUp = () => {
      stop();
      if (slug !== null && mayKeepRecord()) {
        try {
          localStorage.setItem(popupStorageKey(slug), serializeDismissal({ at: clock.now(), submitted: true }));
        } catch {
          // Blocked storage: the popup simply is not remembered.
        }
      }
    };

    window.addEventListener(OPT_IN_DONE_EVENT, onSignedUp);
    if (plan.time) timer = setTimeout(tryTime, delaySeconds * 1000);
    if (plan.exit) {
      armTimer = setTimeout(() => document.addEventListener("mouseout", onLeave), EXIT_ARM_MS);
    }
    return () => {
      stop();
      window.removeEventListener(OPT_IN_DONE_EVENT, onSignedUp);
    };
  }, [trigger, delaySeconds, rememberDays, closeOnOverlay, hideOnDesktop, hideOnMobile, label]);

  function close() {
    setOpen(false);
    const { slug } = page.current;
    if (slug === null || rememberDays <= 0 || !mayKeepRecord()) return;
    const key = popupStorageKey(slug);
    const before = parseDismissal(readStorage(key));
    try {
      localStorage.setItem(key, serializeDismissal({ at: clock.now(), submitted: before?.submitted === true }));
    } catch {
      // Blocked storage: the popup simply is not remembered.
    }
  }

  return (
    <>
      <span ref={anchor} hidden data-exit-popup-anchor />
      {open && (
        <Suspense fallback={null}>
          <ExitPopupDialog label={label} boxClass={boxClass} frameClass={frameClass} closeOnOverlay={closeOnOverlay} onClose={close}>
            {children}
          </ExitPopupDialog>
        </Suspense>
      )}
    </>
  );
}
