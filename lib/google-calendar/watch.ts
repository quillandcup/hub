import { randomUUID } from "node:crypto";
import type { GoogleCalendarClient } from "@/lib/google-calendar/client";
import type { Repos } from "@/lib/data/repos";

const DAY_MS = 24 * 60 * 60 * 1000;
// Ask Google for a week; it may grant less, so the row stores the expiry it returns.
const REQUESTED_LIFETIME_MS = 7 * DAY_MS;
// The renewal runs daily, so a channel with under 3 days left is replaced with plenty of margin.
const RENEW_WHEN_LEFT_MS = 3 * DAY_MS;

export type WatchResult =
  | { action: "kept"; channelId: string; expiresAt: string }
  | { action: "created"; channelId: string; expiresAt: string; stopped: number };

/**
 * Make sure one push channel is live for the calendar with enough time left; open a new one and
 * stop the old ones when not. The new channel is opened before the old are stopped, so no change
 * goes unnoticed in between (briefly both deliver; the sync they trigger is idempotent).
 * Throws when Google refuses to open the channel; a failure to stop an old one is only logged,
 * since Google drops it at expiry anyway.
 */
export async function ensureCalendarWatchChannel(params: {
  repos: Pick<Repos, "calendarSyncState">;
  client: Pick<GoogleCalendarClient, "watchEvents" | "stopChannel">;
  calendarId: string;
  address: string;
  token: string;
  now?: Date;
}): Promise<WatchResult> {
  const { repos, client, calendarId, address, token } = params;
  const now = params.now ?? new Date();

  const state = repos.calendarSyncState;
  const active = await state.activeWatchChannels(calendarId).catch((error: Error) => {
    throw new Error(`Failed to read calendar watch channels: ${error.message}`);
  });

  const current = active.find((c) => new Date(c.expiresAt).getTime() - now.getTime() > RENEW_WHEN_LEFT_MS);
  if (current) {
    return { action: "kept", channelId: current.channelId, expiresAt: current.expiresAt };
  }

  const channelId = randomUUID();
  const opened = await client.watchEvents({
    calendarId,
    channelId,
    address,
    token,
    expiration: new Date(now.getTime() + REQUESTED_LIFETIME_MS),
  });
  try {
    await state.saveWatchChannel({ calendarId, channelId, resourceId: opened.resourceId, expiresAt: opened.expiresAt });
  } catch (insertError) {
    // Without a row the channel can't be stopped or renewed later; don't leave it delivering.
    await client.stopChannel(channelId, opened.resourceId).catch(() => undefined);
    throw new Error(`Failed to save calendar watch channel: ${insertError instanceof Error ? insertError.message : insertError}`);
  }

  let stopped = 0;
  for (const old of active) {
    try {
      await client.stopChannel(old.channelId, old.resourceId);
    } catch (e) {
      // Usually "channel not found" because it already expired.
      console.warn(`[calendar-watch] could not stop channel ${old.channelId}:`, e);
    }
    // A failure to record it leaves the old channel to be retried (and re-stopped) tomorrow.
    await state.markWatchChannelStopped(old.id, now).catch((e) => console.warn(`[calendar-watch] could not mark channel ${old.channelId} stopped:`, e));
    stopped++;
  }

  return { action: "created", channelId, expiresAt: opened.expiresAt.toISOString(), stopped };
}
