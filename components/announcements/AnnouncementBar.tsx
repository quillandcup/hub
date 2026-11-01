"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { ANNOUNCEMENT_BAR_LAYOUT, ANNOUNCEMENT_TONE_CLASSES, type AnnouncementTone } from "./tones";

export type AnnouncementAction = {
  label: string;
  /** `data-track` name. */
  track: string;
  /** A link (use `external` for a full navigation, such as an OAuth start route)... */
  href?: string;
  external?: boolean;
  /** ...or a button that runs this... */
  onClick?: () => void;
  /** ...or a button that submits a server action. */
  formAction?: (formData: FormData) => void | Promise<void>;
};

export type AnnouncementDismiss = {
  /** Storage key; the value written is "1". */
  dismissKey: string;
  /** "session" forgets it when the tab closes (sessionStorage); "device" remembers it (localStorage). */
  scope: "session" | "device";
  /** Button text, "Not now" by default. */
  label?: string;
  track?: string;
};

type Props = {
  tone: AnnouncementTone;
  /** The message. */
  children: ReactNode;
  action?: AnnouncementAction;
  dismiss?: AnnouncementDismiss;
  /** Defaults to "alert" for critical and "status" otherwise. */
  role?: "status" | "alert";
  "aria-label"?: string;
};

function storageFor(scope: "session" | "device"): Storage {
  return scope === "session" ? sessionStorage : localStorage;
}

/**
 * One bar across the top of the member area or a page: a message, an optional action and an optional
 * dismiss. Bars above the header are placed by AnnouncementStack; a page puts PageBanner under the header.
 * A dismissible bar is hidden until its stored state has been read, since the server can't know it
 * (no flash, no hydration mismatch); storage that is blocked just means it shows every visit.
 */
export default function AnnouncementBar({ tone, children, action, dismiss, role, "aria-label": ariaLabel }: Props) {
  const [dismissed, setDismissed] = useState(Boolean(dismiss));
  const key = dismiss?.dismissKey;
  const scope = dismiss?.scope;
  useEffect(() => {
    if (!key || !scope) return;
    let stored = false;
    try {
      stored = storageFor(scope).getItem(key) === "1";
    } catch {
      // Storage blocked: show it every visit rather than never.
    }
    setDismissed(stored);
  }, [key, scope]);

  if (dismiss && dismissed) return null;

  const solid = tone !== "info";
  const actionClass = solid
    ? "cursor-pointer font-medium underline underline-offset-2 hover:no-underline"
    : "rounded-lg bg-plum-600 px-3 py-1 font-medium text-white hover:bg-plum-700";
  const dismissClass = solid
    ? "cursor-pointer underline underline-offset-2 hover:no-underline"
    : "text-plum-800 underline-offset-2 hover:underline dark:text-plum-100";

  let actionEl: ReactNode = null;
  if (action?.formAction) {
    actionEl = (
      <form action={action.formAction}>
        <button type="submit" data-track={action.track} className={actionClass}>{action.label}</button>
      </form>
    );
  } else if (action?.href && action.external) {
    actionEl = <a data-track={action.track} href={action.href} className={actionClass}>{action.label}</a>;
  } else if (action?.href) {
    actionEl = <Link data-track={action.track} href={action.href} className={actionClass}>{action.label}</Link>;
  } else if (action) {
    actionEl = <button type="button" data-track={action.track} onClick={action.onClick} className={actionClass}>{action.label}</button>;
  }

  return (
    <section
      role={role ?? (tone === "critical" ? "alert" : "status")}
      aria-label={ariaLabel}
      className={`${ANNOUNCEMENT_BAR_LAYOUT} ${ANNOUNCEMENT_TONE_CLASSES[tone]}`}
    >
      <div className="min-w-0 flex-1">{children}</div>
      {actionEl}
      {dismiss && (
        <button
          type="button"
          data-track={dismiss.track}
          onClick={() => {
            try {
              storageFor(dismiss.scope).setItem(dismiss.dismissKey, "1");
            } catch {
              // Dismissed for this visit only.
            }
            setDismissed(true);
          }}
          className={dismissClass}
        >
          {dismiss.label ?? "Not now"}
        </button>
      )}
    </section>
  );
}
