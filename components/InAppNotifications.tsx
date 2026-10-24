"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { externalLinkProps } from "@/lib/notification-links";
import {
  getMyBellState,
  markAllInAppNotificationsReadAction,
  markInAppNotificationsReadAction,
  markInAppNotificationsUnreadAction,
  type BellState,
} from "@/app/actions/in-app-notifications";
import type { InAppNotification } from "@/lib/channels/in-app";
import { formatRelativeTime } from "@/lib/formatters";
import { useTimeZone } from "@/components/Timezone";
import { track } from "@/lib/analytics/client";

/** At most this many banners at once; the rest are still in the bell. */
export const MAX_BANNERS = 3;

/** How often to look for new notifications while the tab is visible (check-ins go out ~20 min before a prickle). */
export const IN_APP_POLL_MS = 60_000;

export const INBOX_PATH = "/notifications";

/**
 * The "In the Hub" notification channel (lib/channels/in-app.ts) in the member layout: a bell in
 * the header (unread count, the latest few, mark all read, a link to the inbox) and a banner under
 * it for unread time-sensitive ones. Both, and the inbox page, share InAppNotificationsProvider so
 * the count stays in step. The layout doesn't re-render on client navigation, so the provider polls
 * while the tab is visible (and checks again when the tab comes back) instead of relying on the
 * server-rendered state.
 */
interface InAppState extends BellState {
  error: string | null;
  /** Marks these read: optimistic, then refreshed from the server so the count is exact. */
  markRead: (ids: string[]) => Promise<boolean>;
  /** Puts these back to unread, same shape as markRead. */
  markUnread: (ids: string[]) => Promise<boolean>;
  markAllRead: () => Promise<boolean>;
}

const InAppContext = createContext<InAppState | null>(null);

export function useInAppNotifications(): InAppState {
  const state = useContext(InAppContext);
  if (!state) throw new Error("Inside InAppNotificationsProvider only");
  return state;
}

export function InAppNotificationsProvider({ initial, children }: { initial: BellState; children: React.ReactNode }) {
  const [bell, setBell] = useState(initial);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setBell(await getMyBellState());
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

  const apply = useCallback(
    async (optimistic: (b: BellState) => BellState, save: () => Promise<{ success: true } | { error: string }>) => {
      const before = bell;
      setBell(optimistic);
      setError(null);
      const result = await save();
      if ("error" in result) {
        setBell(before);
        setError(result.error);
        return false;
      }
      await refresh();
      return true;
    },
    [bell, refresh]
  );

  const markRead = useCallback(
    (ids: string[]) =>
      apply(
        (b) => ({
          latest: b.latest.map((n) => (ids.includes(n.id) ? { ...n, read: true, banner: false } : n)),
          unreadCount: Math.max(0, b.unreadCount - b.latest.filter((n) => ids.includes(n.id) && !n.read).length),
        }),
        () => markInAppNotificationsReadAction(ids)
      ),
    [apply]
  );

  const markUnread = useCallback(
    (ids: string[]) =>
      apply(
        (b) => ({
          latest: b.latest.map((n) => (ids.includes(n.id) ? { ...n, read: false } : n)),
          unreadCount: b.unreadCount + b.latest.filter((n) => ids.includes(n.id) && n.read).length,
        }),
        () => markInAppNotificationsUnreadAction(ids)
      ),
    [apply]
  );

  const markAllRead = useCallback(
    () =>
      apply(
        (b) => ({ latest: b.latest.map((n) => ({ ...n, read: true, banner: false })), unreadCount: 0 }),
        () => markAllInAppNotificationsReadAction()
      ),
    [apply]
  );

  return (
    <InAppContext.Provider value={{ ...bell, error, markRead, markUnread, markAllRead }}>{children}</InAppContext.Provider>
  );
}

/** "+N more" in a banner: the others are in the inbox. */
function MorePill({ count, className }: { count: number; className: string }) {
  return (
    <Link
      href={INBOX_PATH}
      data-track="notifications-banner-more"
      aria-label={`${count} more notifications`}
      className={`${className} shrink-0 rounded-full bg-white/20 px-2 py-0.5 text-xs font-medium text-white hover:bg-white/30`}
    >
      +{count} more
    </Link>
  );
}

/** Unread, still time-sensitive notifications, as strips under the header, each dismissible. Renders nothing outside the provider (no member record). */
export function InAppNotificationBanner() {
  return useContext(InAppContext) ? <BannerStrips /> : null;
}

function BannerStrips() {
  const { latest, error, markRead } = useInAppNotifications();
  const unread = latest.filter((n) => n.banner);
  const banners = unread.slice(0, MAX_BANNERS);
  // A "+N more" pill links to the inbox for the banners not shown: on sm and up in the last
  // banner (those past the cap), below sm in the first, the only one shown.
  const moreOnMobile = unread.length - 1;
  const moreOnDesktop = unread.length - banners.length;
  if (banners.length === 0 && !error) return null;

  return (
    <div aria-label="Time-sensitive notifications" role="region" className="flex-shrink-0">
      {banners.map((n, i) => (
        <div
          key={n.id}
          className={`${i === 0 ? "flex" : "hidden sm:flex"} items-center gap-3 border-b border-plum-700 bg-plum-600 px-6 py-2 text-sm text-white`}
        >
          <p className="min-w-0 flex-1">
            {n.text}
            {n.url && (
              <>
                {" "}
                <Link
                  href={n.url}
                  {...externalLinkProps(n.url)}
                  onClick={() => {
                    track("notification_opened", { kind: n.kind, channel: "in_app" });
                    markRead([n.id]);
                  }}
                  className="font-medium text-white underline underline-offset-2 hover:text-plum-100"
                >
                  Open&nbsp;→
                </Link>
              </>
            )}
          </p>
          {i === 0 && moreOnMobile > 0 && <MorePill count={moreOnMobile} className="sm:hidden" />}
          {i === banners.length - 1 && moreOnDesktop > 0 && <MorePill count={moreOnDesktop} className="hidden sm:inline" />}
          <button
            type="button"
            onClick={() => markRead([n.id])}
            aria-label={`Dismiss: ${n.text}`}
            className="-my-2 -mr-2 flex h-9 w-9 shrink-0 items-center justify-center rounded text-plum-100 hover:bg-plum-700 hover:text-white"
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

/** One notification in the bell or the inbox: unread ones are tinted and dotted; opening one marks it read. */
export function NotificationRow({
  notification: n,
  onOpen,
}: {
  notification: InAppNotification;
  onOpen: (n: InAppNotification) => void;
}) {
  const timeZone = useTimeZone();
  const body = (
    <span className="flex items-start gap-2">
      <span
        aria-hidden="true"
        className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${n.read ? "bg-transparent" : "bg-plum-600"}`}
      />
      <span className="min-w-0">
        <span className={`block ${n.read ? "text-slate-600 dark:text-slate-400" : "font-medium text-slate-900 dark:text-slate-100"}`}>
          {n.text}
          {!n.read && <span className="sr-only"> (unread)</span>}
        </span>
        <span className="mt-0.5 block text-xs text-slate-400">{formatRelativeTime(n.createdAt, timeZone)}</span>
      </span>
    </span>
  );
  const rowClass = `block w-full px-4 py-3 text-left ${n.read ? "" : "bg-plum-50/60 dark:bg-plum-950/60"}`;
  return n.url ? (
    <Link href={n.url} {...externalLinkProps(n.url)} data-track="notifications-open-item" onClick={() => onOpen(n)} className={`${rowClass} hover:bg-slate-50 dark:hover:bg-slate-800`}>
      {body}
    </Link>
  ) : (
    <button type="button" data-track="notifications-open-item" onClick={() => onOpen(n)} className={`${rowClass} hover:bg-slate-50 dark:hover:bg-slate-800`}>
      {body}
    </button>
  );
}

/** The header bell: unread count, the latest few, mark all read, and the way to the inbox. */
export function InAppNotificationBell() {
  return useContext(InAppContext) ? <BellMenu /> : null;
}

function BellMenu() {
  const { latest, unreadCount, markRead, markAllRead } = useInAppNotifications();
  const [isOpen, setIsOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

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

  function open(n: InAppNotification) {
    track("notification_opened", { kind: n.kind, channel: "in_app" });
    if (!n.read) markRead([n.id]);
    if (n.url) setIsOpen(false);
  }

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setIsOpen((o) => !o)}
        data-track="notifications-bell"
        aria-expanded={isOpen}
        aria-label={unreadCount > 0 ? `Notifications, ${unreadCount} unread` : "Notifications"}
        className="relative flex h-10 w-10 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200"
      >
        <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden="true" focusable="false">
          <path
            fill="currentColor"
            d="M12 2a1 1 0 0 1 1 1v.6A6 6 0 0 1 18 9.5v3.8l1.7 2.6a1 1 0 0 1-.8 1.6H5.1a1 1 0 0 1-.8-1.6L6 13.3V9.5a6 6 0 0 1 5-5.9V3a1 1 0 0 1 1-1zm-2.4 17h4.8a2.4 2.4 0 0 1-4.8 0z"
          />
        </svg>
        {unreadCount > 0 && (
          <span
            aria-hidden="true"
            className="absolute -right-0.5 -top-0.5 min-w-[1.1rem] rounded-full bg-plum-600 px-1 text-center text-[0.65rem] font-semibold leading-[1.1rem] text-white"
          >
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>

      {isOpen && (
        <div className="absolute right-0 z-40 mt-2 w-80 max-w-[calc(100vw-2rem)] overflow-hidden rounded-lg border border-slate-200 bg-white shadow-lg dark:border-slate-700 dark:bg-slate-900">
          <div className="flex items-center justify-between border-b border-slate-200 px-4 py-2 dark:border-slate-700">
            <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Notifications</h2>
            <button
              type="button"
              onClick={() => markAllRead()}
              data-track="notifications-mark-all-read"
              disabled={unreadCount === 0}
              className="text-xs text-plum-600 hover:underline disabled:cursor-default disabled:text-slate-400 disabled:no-underline dark:text-plum-400"
            >
              Mark all as read
            </button>
          </div>
          {latest.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-slate-500 dark:text-slate-400">Nothing yet.</p>
          ) : (
            <ul className="max-h-96 overflow-y-auto text-sm">
              {latest.map((n) => (
                <li key={n.id} className="border-b border-slate-100 last:border-b-0 dark:border-slate-800">
                  <NotificationRow notification={n} onOpen={open} />
                </li>
              ))}
            </ul>
          )}
          <Link
            href={INBOX_PATH}
            data-track="notifications-see-all"
            onClick={() => setIsOpen(false)}
            className="block border-t border-slate-200 px-4 py-2 text-center text-sm text-plum-600 hover:bg-slate-50 dark:border-slate-700 dark:text-plum-400 dark:hover:bg-slate-800"
          >
            See all notifications →
          </Link>
        </div>
      )}
    </div>
  );
}
