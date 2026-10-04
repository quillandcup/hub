"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { dismissInAppNotification, getMyInAppNotifications } from "@/app/actions/in-app-notifications";
import type { InAppNotification } from "@/lib/channels/in-app";

/** How often to look for new banners while the tab is visible (check-ins go out ~20 min before a prickle). */
export const IN_APP_POLL_MS = 60_000;

/**
 * The "In the Hub" notification channel (lib/channels/in-app.ts): a slim strip under the member
 * header per active notification, linking to where to act on it, with a dismiss button. The member
 * layout doesn't re-render on client navigation, so it polls while the tab is visible (and checks
 * again when the tab comes back) instead of relying on the server-rendered list.
 */
export default function InAppNotificationBanner({ initial }: { initial: InAppNotification[] }) {
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

  async function dismiss(id: string) {
    const before = notifications;
    setNotifications((list) => list.filter((n) => n.id !== id));
    setError(null);
    const result = await dismissInAppNotification(id);
    if ("error" in result) {
      setNotifications(before);
      setError(result.error);
    }
  }

  if (notifications.length === 0 && !error) return null;

  return (
    <div aria-label="Notifications" role="region" className="flex-shrink-0">
      {notifications.map((n) => (
        <div
          key={n.id}
          className="flex items-center gap-3 border-b border-plum-200 bg-plum-50 px-6 py-2 text-sm text-plum-900 dark:border-plum-900 dark:bg-plum-950 dark:text-plum-100"
        >
          <p className="min-w-0 flex-1">
            {n.text}
            {n.url && (
              <>
                {" "}
                <Link href={n.url} className="font-medium text-plum-700 underline-offset-2 hover:underline dark:text-plum-300">
                  Open →
                </Link>
              </>
            )}
          </p>
          <button
            type="button"
            onClick={() => dismiss(n.id)}
            aria-label={`Dismiss: ${n.text}`}
            className="shrink-0 rounded p-1 text-plum-500 hover:bg-plum-100 hover:text-plum-700 dark:hover:bg-plum-900 dark:hover:text-plum-200"
          >
            ×
          </button>
        </div>
      ))}
      {error && (
        <p role="alert" className="border-b border-red-200 bg-red-50 px-6 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
          {error}
        </p>
      )}
    </div>
  );
}
