"use client";

import { lazy, Suspense, useEffect, useRef, useState, type ReactNode } from "react";
import { EXIT_ARM_MS, OPT_IN_DONE_EVENT, TYPING_RETRY_MS, hasSignInCookie, isExitIntent, planTriggers, publicSlugOf, type ExitPopupSettings } from "@/lib/landing/exit-popup";
import { isQuietHere, rememberClose } from "@/lib/landing/popup-memory";

/**
 * The part of an Exit popup that runs on the public page (docs/product/LANDING_PAGES.md, "Exit popup"): it watches for the moment to
 * show the popup and draws nothing until then (a hidden, empty anchor: no layout shift, and the popup's blocks are not in the page's
 * HTML). The window itself, with its focus handling, is a separate chunk (ExitPopupDialog.tsx), fetched when the page is idle so
 * that it is there at the moment of showing, and not before.
 *
 * Who never sees it: a signed-in member or staff (a sign-in cookie), anyone who closed any exit popup on the site within the days
 * that popup asked for, anyone who signed up through any sign-up form on any landing page, and anyone whose device the settings hide
 * it on. The editor and the admin preview (an address other than `/p/<page>`) ignore the signed-in and "closed before" rules, so
 * staff can see it, and never keep anything.
 *
 * What is remembered: two small site-wide records in the visitor's own browser (a sign-up, and the last close with its days; see
 * `src/lib/landing/popup-memory.ts`), and only where the consent banner does not ask or has been accepted (`mayRemember`). Without that the popup shows at most once per page load. Nothing is sent anywhere.
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
      if (isQuietHere(slug, rememberDays)) return;
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
    // A sign-up anywhere on the page ends it: no popup after the visitor has signed up (the form itself records it site-wide).
    const onSignedUp = () => stop();

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
    // Only the real page remembers; the editor and the preview keep nothing.
    if (page.current.slug !== null) rememberClose(rememberDays);
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
