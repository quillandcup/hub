"use client";

import { useState } from "react";
import Link from "next/link";
import { track } from "@/lib/analytics/client";

interface EventLink {
  id: string;
  slug: string;
  hidden: boolean;
}

/**
 * Admin-only: shows this calendar prickle in Events, and hides or restores it for members. Starts from
 * the event that follows the prickle's calendar event, if there is one.
 */
export default function ShowInEvents({ calendarEventId, initial }: { calendarEventId: string; initial: EventLink | null }) {
  const [event, setEvent] = useState<EventLink | null>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function request(url: string, body: unknown): Promise<Record<string, any>> {
    const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "That didn't work");
    return data;
  }

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const show = () =>
    run(async () => {
      try {
        const data = await request("/api/admin/events/calendar", { calendarEventId });
        setEvent({ id: data.event.id, slug: data.event.slug, hidden: !!data.event.hidden });
        track("event_created", { from: "calendar_item", ok: true });
      } catch (err) {
        track("event_created", { from: "calendar_item", ok: false });
        throw err;
      }
    });

  const setHidden = (hidden: boolean) =>
    run(async () => {
      if (!event) return;
      await request(`/api/admin/events/${event.id}/visibility`, { hidden });
      setEvent({ ...event, hidden });
    });

  return (
    <section className="bg-white dark:bg-slate-900 rounded-lg shadow p-6">
      <h2 className="text-lg font-semibold mb-1">Events</h2>
      {error && <p className="mb-2 text-sm text-red-700 dark:text-red-300">{error}</p>}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
        {!event ? (
          <>
            <p className="text-slate-600 dark:text-slate-400">Not shown in Events.</p>
            <button
              type="button"
              disabled={busy}
              onClick={show}
              className="px-3 py-1.5 bg-plum-600 text-white rounded hover:bg-plum-700 disabled:opacity-50"
            >
              {busy ? "Adding..." : "Show in Events"}
            </button>
          </>
        ) : (
          <>
            <p className="text-slate-600 dark:text-slate-400">{event.hidden ? "Removed from Events." : "Shown in Events."}</p>
            <Link href={`/admin/events/${event.slug}`} className="text-plum-600 dark:text-plum-400 hover:underline">
              Edit the event
            </Link>
            <button
              type="button"
              disabled={busy}
              onClick={() => setHidden(!event.hidden)}
              className="text-plum-600 dark:text-plum-400 hover:underline disabled:opacity-50"
            >
              {event.hidden ? "Add back to Events" : "Remove from Events"}
            </button>
          </>
        )}
      </div>
      <p className="mt-3 text-xs text-slate-600 dark:text-slate-400">
        You can also add #event to the event&apos;s description in Google Calendar.
      </p>
    </section>
  );
}
