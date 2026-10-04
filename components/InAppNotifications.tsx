"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { getMyInAppNotifications, markInAppNotificationsReadAction } from "@/app/actions/in-app-notifications";
import type { InAppNotification } from "@/lib/channels/in-app";
import { formatRelativeTime } from "@/lib/formatters";

/** At most this many banners at once; the rest are still in the bell. */
export const MAX_BANNERS = 3;

/** How often to look for new notifications while the tab is visible (check-ins go out ~20 min before a prickle). */
export const IN_APP_POLL_MS = 60_000;

/**
 * The "In the Hub" notification channel (lib/channels/in-app.ts) in the member layout: a bell in
 * the header listing recent notifications, and a banner under it for unread time-sensitive ones.
 * Both read one list from InAppNotificationsProvider. The layout doesn't re-render on client
 * navigation, so the provider polls while the tab is visible (and checks again when the tab comes
 * back) instead of relying on the server-rendered list.
 */
interface InAppState {
  notifications: InAppNotification[];
  error: string | null;
  markRead: (ids: string[]) => Promise<void>;
}

const InAppContext = createContext<InAppState | null>(null);

function useInApp(): InAppState {
  const state = useContext(InAppContext);
  if (!state) throw new Error("Inside InAppNotificationsProvider only");
  return state;
}

export function InAppNotificationsProvider({
  initial,
  children,
}: {
  initial: InAppNotification[];
  children: React.ReactNode;
}) {
  const [notifications, setNotifications] = useState(initial);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setNotifications(await getMyInAppNotifications());
    } catch {
      // Offline or a deploy in progress: keep what's showing and try again on the next poll.
    }
  }, []);

  useEffect(() => {
    const interval = setInterval(() => {
      if (document.visibilityState === "visible") refresh();
    }, IN_APP_POLL_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refresh]);

  const markRead = useCallback(
    async (ids: string[]) => {
      if (ids.length === 0) return;
      const before = notifications;
      setNotifications((list) => list.map((n) => (ids.includes(n.id) ? { ...n, read: true, banner: false } : n)));
      setError(null);
      const result = await markInAppNotificationsReadAction(ids);
      if ("error" in result) {
        setNotifications(before);
        setError(result.error);
      }
    },
    [notifications]
  );

  return <InAppContext.Provider value={{ notifications, error, markRead }}>{children}</InAppContext.Provider>;
}

/** Unread, still time-sensitive notifications, as strips under the header, each dismissible. */
export function InAppNotificationBanner() {
  const { notifications, error, markRead } = useInApp();
  const banners = notifications.filter((n) => n.banner).slice(0, MAX_BANNERS);
  if (banners.length === 0 && !error) return null;

  return (
    <div aria-label="Time-sensitive notifications" role="region" className="flex-shrink-0">
      {banners.map((n) => (
        <div
          key={n.id}
          className="flex items-center gap-3 border-b border-plum-200 bg-plum-50 px-6 py-2 text-sm text-plum-900 dark:border-plum-900 dark:bg-plum-950 dark:text-plum-100"
        >
          <p className="min-w-0 flex-1">
            {n.text}
            {n.url && (
              <>
                {" "}
                <Link
                  href={n.url}
                  className="font-medium text-plum-700 underline-offset-2 hover:underline dark:text-plum-300"
                >
                  Open →
                </Link>
              </>
            )}
          </p>
          <button
            type="button"
            onClick={() => markRead([n.id])}
            aria-label={`Dismiss: ${n.text}`}
            className="shrink-0 rounded p-1 text-plum-500 hover:bg-plum-100 hover:text-plum-700 dark:hover:bg-plum-900 dark:hover:text-plum-200"
          >
            ×
          </button>
        </div>
      ))}
      {error && (
        <p
          role="alert"
          className="border-b border-red-200 bg-red-50 px-6 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300"
        >
          {error}
        </p>
      )}
    </div>
  );
}

/** The header bell: unread count, and the recent list. Opening it marks what's listed read. */
export function InAppNotificationBell() {
  const { notifications, markRead } = useInApp();
  const [isOpen, setIsOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const unread = notifications.filter((n) => !n.read);

  useEffect(() => {
    if (!isOpen) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setIsOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setIsOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [isOpen]);

  // What was unread when it opened stays highlighted while it's open, though it's now read.
  const [highlighted, setHighlighted] = useState<string[]>([]);
  function onToggle() {
    if (!isOpen) {
      const ids = unread.map((n) => n.id);
      setHighlighted(ids);
      markRead(ids);
    }
    setIsOpen((open) => !open);
  }

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={isOpen}
        aria-label={unread.length > 0 ? `Notifications, ${unread.length} unread` : "Notifications"}
        className="relative rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200"
      >
        <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden="true" focusable="false">
          <path
            fill="currentColor"
            d="M12 2a1 1 0 0 1 1 1v.6A6 6 0 0 1 18 9.5v3.8l1.7 2.6a1 1 0 0 1-.8 1.6H5.1a1 1 0 0 1-.8-1.6L6 13.3V9.5a6 6 0 0 1 5-5.9V3a1 1 0 0 1 1-1zm-2.4 17h4.8a2.4 2.4 0 0 1-4.8 0z"
          />
        </svg>
        {unread.length > 0 && (
          <span
            aria-hidden="true"
            className="absolute -right-0.5 -top-0.5 min-w-[1.1rem] rounded-full bg-plum-600 px-1 text-center text-[0.65rem] font-semibold leading-[1.1rem] text-white"
          >
            {unread.length > 9 ? "9+" : unread.length}
          </span>
        )}
      </button>

      {isOpen && (
        <div className="absolute right-0 z-40 mt-2 w-80 max-w-[calc(100vw-2rem)] overflow-hidden rounded-lg border border-slate-200 bg-white shadow-lg dark:border-slate-700 dark:bg-slate-900">
          <h2 className="border-b border-slate-200 px-4 py-2 text-sm font-semibold text-slate-900 dark:border-slate-700 dark:text-slate-100">
            Notifications
          </h2>
          {notifications.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-slate-500 dark:text-slate-400">Nothing yet.</p>
          ) : (
            <ul className="max-h-96 overflow-y-auto text-sm">
              {notifications.map((n) => {
                const fresh = highlighted.includes(n.id);
                const body = (
                  <>
                    <span className="block text-slate-800 dark:text-slate-200">{n.text}</span>
                    <span className="mt-0.5 block text-xs text-slate-400">{formatRelativeTime(n.createdAt)}</span>
                  </>
                );
                const itemClass = `block px-4 py-3 ${fresh ? "bg-plum-50 dark:bg-plum-950" : ""}`;
                return (
                  <li key={n.id} className="border-b border-slate-100 last:border-b-0 dark:border-slate-800">
                    {n.url ? (
                      <Link
                        href={n.url}
                        onClick={() => setIsOpen(false)}
                        className={`${itemClass} hover:bg-slate-50 dark:hover:bg-slate-800`}
                      >
                        {body}
                      </Link>
                    ) : (
                      <div className={itemClass}>{body}</div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
