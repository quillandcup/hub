import type { Repos } from "@/lib/data/repos";
import { clock } from "@/lib/clock";
import type { GoogleCalendarClient } from "@/lib/google-calendar/client";
import { isTimedEvent, toBronzeEvent } from "@/lib/google-calendar/events";
import {
  abandonCalendarSync,
  claimCalendarSync,
  releaseCalendarSync,
  saveSyncedThrough,
} from "@/lib/google-calendar/sync-state";

const DAY_MS = 24 * 60 * 60 * 1000;

/** The window the nightly reconcile keeps in step with Google; incremental runs watch the same one. */
export const SYNC_WINDOW_DAYS = { back: 90, forward: 90 } as const;
/** Fetch a little before the watermark: clocks differ, and re-fetching an item is harmless. */
const OVERLAP_MS = 5 * 60 * 1000;
/** A watermark older than this means notifications stopped arriving: do a full sync instead. */
const MAX_WATERMARK_AGE_MS = 2 * DAY_MS;
/** Reprocess a day either side of the touched events, so day-boundary and timezone edges are inside. */
const RANGE_PAD_MS = DAY_MS;

export function syncWindow(now: Date): { timeMin: string; timeMax: string } {
  return {
    timeMin: new Date(now.getTime() - SYNC_WINDOW_DAYS.back * DAY_MS).toISOString(),
    timeMax: new Date(now.getTime() + SYNC_WINDOW_DAYS.forward * DAY_MS).toISOString(),
  };
}

/** The import computes its range in calendar days (setDate), which can be an hour off 90 x 24h across a DST change. */
const DST_SLACK_MS = 2 * 60 * 60 * 1000;

/** Whether a full sync over [from, to] leaves Bronze current for everything an incremental run watches. */
export function coversSyncWindow(from: Date, to: Date, now: Date): boolean {
  const { timeMin, timeMax } = syncWindow(now);
  return from.getTime() <= new Date(timeMin).getTime() + DST_SLACK_MS && to.getTime() >= new Date(timeMax).getTime() - DST_SLACK_MS;
}

type SyncClient = Pick<GoogleCalendarClient, "listChangedEvents" | "listCancelledEvents">;

export type CalendarSyncResult =
  | { status: "queued" }
  | { status: "done"; runs: Array<{ mode: "incremental"; changed: number; deleted: number; range: { from: string; to: string } | null } | { mode: "full" }> };

/**
 * Bring Bronze (and Silver, for the dates touched) up to date after a push notification, fetching
 * only the events Google changed since the last sync instead of the whole window.
 *
 * - Concurrent notifications coalesce: one sync runs; the rest note "run once more" and return.
 * - No watermark yet, or one older than two days: falls back to `fullSync` (which should cover the
 *   sync window; the watermark is then saved here).
 * - A failure leaves the watermark where it was, so the next notification retries the same span.
 * The nightly reconcile stays the guaranteed path (it also catches events moved out of the window).
 */
export async function syncCalendarChanges(deps: {
  repos: Pick<Repos, "calendarEvents" | "calendarSyncState">;
  client: SyncClient;
  calendarId: string;
  fullSync: () => Promise<unknown>;
  reprocess: (range: { from: Date; to: Date }) => Promise<unknown>;
}): Promise<CalendarSyncResult> {
  const { repos, client, calendarId } = deps;
  const claim = await claimCalendarSync(repos, calendarId, new Date(clock.now()));
  if (!claim.claimed) return { status: "queued" };

  const runs: Extract<CalendarSyncResult, { status: "done" }>["runs"] = [];
  let since = claim.syncedThrough;
  try {
    for (;;) {
      const startedAt = new Date(clock.now());
      if (since && startedAt.getTime() - since.getTime() < MAX_WATERMARK_AGE_MS) {
        runs.push(await applyChanges({ ...deps, since, startedAt }));
      } else {
        await deps.fullSync();
        runs.push({ mode: "full" });
      }
      await saveSyncedThrough(repos, calendarId, startedAt);
      since = startedAt;
      if (await releaseCalendarSync(repos, calendarId, new Date(clock.now()))) break;
    }
  } catch (error) {
    await abandonCalendarSync(repos, calendarId);
    throw error;
  }
  return { status: "done", runs };
}

async function applyChanges(params: {
  repos: Pick<Repos, "calendarEvents" | "calendarSyncState">;
  client: SyncClient;
  calendarId: string;
  reprocess: (range: { from: Date; to: Date }) => Promise<unknown>;
  since: Date;
  startedAt: Date;
}) {
  const { repos, client, calendarId, since, startedAt } = params;
  const repo = repos.calendarEvents;

  const updatedMin = new Date(since.getTime() - OVERLAP_MS).toISOString();
  // Updates are only kept inside the watched window, but a deletion can be of any event (a past
  // prickle taken off the calendar), so cancelled events are asked for without a window.
  const [changed, cancelled] = await Promise.all([
    client.listChangedEvents(calendarId, { updatedMin, ...syncWindow(startedAt) }),
    client.listCancelledEvents(calendarId, updatedMin),
  ]);
  // Cancelled, or no longer a timed event (turned into an all-day one): not in the Hub.
  const goneById = new Map(
    [...changed.filter((e) => e.id && (e.status === "cancelled" || !isTimedEvent(e))), ...cancelled].map((e) => [e.id as string, e])
  );
  const gone = [...goneById.values()];
  const live = changed.filter((e) => e.status !== "cancelled" && isTimedEvent(e));

  // Where the touched events were before and are now, so a moved or deleted event's old dates
  // are reprocessed too.
  const before = await repo.byGoogleIds(live.map((e) => e.id));
  const removed = await repo.deleteByGoogleIds(gone.map((e) => e.id));
  await repo.upsert(live.map((e) => ({ ...toBronzeEvent(e), imported_at: startedAt.toISOString() })));

  const times = [
    ...before.flatMap((e) => [e.start_time, e.end_time]),
    ...removed.flatMap((e) => [e.start_time, e.end_time]),
    ...live.flatMap((e) => [e.start.dateTime, e.end.dateTime]),
  ].map((t) => new Date(t).getTime());

  if (times.length === 0) {
    return { mode: "incremental" as const, changed: 0, deleted: 0, range: null };
  }
  const range = {
    from: new Date(Math.min(...times) - RANGE_PAD_MS),
    to: new Date(Math.max(...times) + RANGE_PAD_MS),
  };
  await params.reprocess(range);
  return {
    mode: "incremental" as const,
    changed: live.length,
    deleted: removed.length,
    range: { from: range.from.toISOString(), to: range.to.toISOString() },
  };
}

/**
 * Remove the events Google reports cancelled since `sinceDays` ago, wherever they were on the
 * calendar, and reprocess the dates they had. The nightly reconcile runs it, because its import only
 * sees the watched window: a deletion of an older event (or one the push notification missed) would
 * otherwise leave a prickle behind for good.
 */
export async function sweepCancelledEvents(params: {
  repos: Pick<Repos, "calendarEvents" | "calendarSyncState">;
  client: Pick<GoogleCalendarClient, "listCancelledEvents">;
  calendarId: string;
  sinceDays: number;
  reprocess: (range: { from: Date; to: Date }) => Promise<unknown>;
}): Promise<{ cancelled: number; deleted: number; range: { from: string; to: string } | null }> {
  const since = new Date(clock.now() - params.sinceDays * DAY_MS);
  const cancelled = await params.client.listCancelledEvents(params.calendarId, since.toISOString());
  const ids = cancelled.map((e) => e.id as string).filter(Boolean);
  const removed = await params.repos.calendarEvents.deleteByGoogleIds(ids);
  if (removed.length === 0) return { cancelled: ids.length, deleted: 0, range: null };

  const times = removed.flatMap((e) => [e.start_time, e.end_time]).map((t) => new Date(t).getTime());
  const range = { from: new Date(Math.min(...times) - RANGE_PAD_MS), to: new Date(Math.max(...times) + RANGE_PAD_MS) };
  await params.reprocess(range);
  return { cancelled: ids.length, deleted: removed.length, range: { from: range.from.toISOString(), to: range.to.toISOString() } };
}
