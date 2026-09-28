"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { CALENDAR_FEED_NAME, type CalendarFeedUrls, type MyCalendarItem } from "@/lib/calendar-feed";
import { regenerateMyCalendarFeedToken, removeMyCalendarItem } from "./calendar-feed-actions";

const COLLAPSED_KEY = "calendarSyncCard:collapsed";

const BUTTON =
  "inline-flex items-center gap-1.5 px-4 py-2 rounded-full border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-sm font-medium text-slate-800 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors";

function CalendarIcon({ className = "" }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24" aria-hidden="true">
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path strokeLinecap="round" d="M3 10h18M8 3v4M16 3v4" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M9.5 15.5l2 2 3.5-4" />
    </svg>
  );
}

/**
 * "Sync your prickles with your calendar": subscribe links for the member's personal feed
 * (hosted + committed prickles, lib/calendar-feed.ts) in Google, Apple and Outlook, plus copy and
 * regenerate. Collapsible; the collapsed state is a per-browser convenience.
 */
export default function CalendarSyncCard({
  initialUrls,
  items = [],
}: {
  initialUrls: CalendarFeedUrls;
  /** Prickles and events the member added by hand (upcoming ones), listed with a remove button. */
  items?: MyCalendarItem[];
}) {
  const router = useRouter();
  const [urls, setUrls] = useState(initialUrls);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [copied, setCopied] = useState(false);
  const [confirmingRegenerate, setConfirmingRegenerate] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    try {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- restore a per-browser preference after hydration
      if (localStorage.getItem(COLLAPSED_KEY) === "1") setCollapsed(true);
    } catch {
      // Storage unavailable: stay expanded.
    }
  }, []);

  function toggleCollapsed() {
    const next = !collapsed;
    setCollapsed(next);
    try {
      localStorage.setItem(COLLAPSED_KEY, next ? "1" : "0");
    } catch {
      // Storage unavailable: the choice just isn't remembered.
    }
  }

  async function copyLink() {
    setError(null);
    try {
      await navigator.clipboard.writeText(urls.https);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError(`Couldn't copy automatically. Your link: ${urls.https}`);
    }
  }

  async function removeItem(id: string) {
    setRemovingId(id);
    setError(null);
    const result = await removeMyCalendarItem(id);
    setRemovingId(null);
    if ("error" in result) {
      setError(result.error);
      return;
    }
    router.refresh();
  }

  async function regenerate() {
    setBusy(true);
    setError(null);
    setMessage(null);
    const result = await regenerateMyCalendarFeedToken();
    setBusy(false);
    setConfirmingRegenerate(false);
    if ("error" in result) {
      setError(result.error);
      return;
    }
    setUrls(result.urls);
    setMessage("New link ready. Calendars using the old link will stop updating, so subscribe again with the buttons above.");
  }

  return (
    <section
      aria-labelledby="calendar-sync-heading"
      className="mb-6 rounded-xl border border-blue-200 dark:border-blue-900 bg-blue-50/50 dark:bg-blue-950/20 p-5"
    >
      <div className="flex items-start gap-3">
        <div className="shrink-0 rounded-full bg-white dark:bg-slate-900 border border-blue-200 dark:border-blue-900 p-2 text-blue-700 dark:text-blue-400">
          <CalendarIcon className="w-5 h-5" />
        </div>
        <div className="flex-1 min-w-0">
          <h2 id="calendar-sync-heading" className="font-semibold text-slate-900 dark:text-slate-100">
            Sync your prickles with your calendar
          </h2>
          <p className="text-sm text-slate-600 dark:text-slate-400 mt-0.5">
            One-time setup. Prickles you host and prickles you&apos;ve committed to show up automatically and stay updated
            on their own. Want others too, like an Educational Prickle or a retreat? Use{" "}
            <span className="font-medium">Add to my calendar</span> in All Prickles or on the event&apos;s page.
          </p>
        </div>
        <button
          type="button"
          onClick={toggleCollapsed}
          aria-expanded={!collapsed}
          aria-controls="calendar-sync-body"
          aria-label={collapsed ? "Show calendar sync options" : "Hide calendar sync options"}
          className="shrink-0 p-1 rounded text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
        >
          <svg className={`w-5 h-5 transition-transform ${collapsed ? "" : "rotate-180"}`} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>
      </div>

      {!collapsed && (
        <div id="calendar-sync-body" className="mt-4">
          <div className="flex flex-wrap gap-2">
            <a href={urls.google} target="_blank" rel="noopener noreferrer" className={BUTTON}>
              Google Calendar
            </a>
            <a href={urls.webcal} className={BUTTON}>
              Apple Calendar
            </a>
            <a href={urls.outlook} target="_blank" rel="noopener noreferrer" className={BUTTON}>
              Outlook
            </a>
            <button type="button" onClick={copyLink} className={BUTTON}>
              <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24" aria-hidden="true">
                <rect x="9" y="9" width="12" height="12" rx="2" />
                <path d="M5 15V5a2 2 0 012-2h10" />
              </svg>
              {copied ? "Copied!" : "Copy link"}
            </button>
          </div>

          {items.length > 0 && (
            <div className="mt-4">
              <h3 className="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide">
                Also added to your calendar
              </h3>
              <ul className="mt-1.5 space-y-1">
                {items.map((item) => (
                  <li key={item.id} className="flex items-center justify-between gap-3 text-sm text-slate-700 dark:text-slate-300">
                    <span className="min-w-0 truncate">{item.label}</span>
                    <button
                      type="button"
                      onClick={() => removeItem(item.id)}
                      disabled={removingId === item.id}
                      aria-label={`Remove ${item.label} from your calendar`}
                      className="shrink-0 text-xs text-slate-500 hover:text-rose-700 dark:hover:text-rose-400 disabled:opacity-50"
                    >
                      {removingId === item.id ? "Removing…" : "Remove"}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <p className="mt-3 text-xs text-slate-600 dark:text-slate-400">
            Reminder 15 minutes before each prickle. Google can take 12–24 hours to pick up changes; Apple and Outlook are
            usually faster. The link is private, so don&apos;t share it.
          </p>

          <details className="mt-3 text-xs text-slate-600 dark:text-slate-400">
            <summary className="cursor-pointer text-blue-700 dark:text-blue-400 font-medium">How does it work?</summary>
            <ol className="mt-2 space-y-1.5 list-decimal pl-5">
              <li>Tap your calendar&apos;s button (Google, Apple or Outlook) and confirm &ldquo;Add&rdquo; or &ldquo;Subscribe&rdquo;.</li>
              <li>
                A new calendar named &ldquo;{CALENDAR_FEED_NAME}&rdquo; appears with the prickles you host, the ones
                you&apos;ve committed to, and anything you added. New commitments, cancellations and schedule changes
                show up on their own.
              </li>
              <li>
                If a button doesn&apos;t open (e.g. Google on mobile), copy the link and paste it in Google Calendar →
                Other calendars → + → From URL.
              </li>
            </ol>
          </details>

          <div className="mt-3 text-xs">
            {confirmingRegenerate ? (
              <div className="flex flex-wrap items-center gap-2 text-slate-700 dark:text-slate-300">
                <span>Calendars subscribed to your current link will stop updating.</span>
                <button
                  type="button"
                  onClick={regenerate}
                  disabled={busy}
                  className="px-2.5 py-1 rounded bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 font-medium disabled:opacity-50"
                >
                  {busy ? "Generating…" : "Generate new link"}
                </button>
                <button type="button" onClick={() => setConfirmingRegenerate(false)} className="px-2.5 py-1 rounded hover:bg-slate-100 dark:hover:bg-slate-800">
                  Cancel
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmingRegenerate(true)}
                className="text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 underline-offset-2 hover:underline"
              >
                Generate new link
              </button>
            )}
          </div>

          {message && <p className="mt-2 text-xs text-emerald-700 dark:text-emerald-400" role="status">{message}</p>}
          {error && <p className="mt-2 text-xs text-rose-700 dark:text-rose-400 break-all" role="alert">{error}</p>}
        </div>
      )}
    </section>
  );
}
