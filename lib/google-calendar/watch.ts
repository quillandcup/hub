import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/data/database.types";
import type { GoogleCalendarClient } from "@/lib/google-calendar/client";

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
  supabase: SupabaseClient<Database>;
  client: Pick<GoogleCalendarClient, "watchEvents" | "stopChannel">;
  calendarId: string;
  address: string;
  token: string;
  now?: Date;
}): Promise<WatchResult> {
  const { supabase, client, calendarId, address, token } = params;
  const now = params.now ?? new Date();

  const { data: active, error } = await supabase
    .from("calendar_watch_channels")
    .select("id, channel_id, resource_id, expires_at")
    .eq("calendar_id", calendarId)
    .is("stopped_at", null)
    .order("expires_at", { ascending: false });
  if (error) throw new Error(`Failed to read calendar watch channels: ${error.message}`);

  const current = (active ?? []).find(
    (c) => new Date(c.expires_at).getTime() - now.getTime() > RENEW_WHEN_LEFT_MS
  );
  if (current) {
    return { action: "kept", channelId: current.channel_id, expiresAt: current.expires_at };
  }

  const channelId = randomUUID();
  const opened = await client.watchEvents({
    calendarId,
    channelId,
    address,
    token,
    expiration: new Date(now.getTime() + REQUESTED_LIFETIME_MS),
  });
  const { error: insertError } = await supabase.from("calendar_watch_channels").insert({
    calendar_id: calendarId,
    channel_id: channelId,
    resource_id: opened.resourceId,
    expires_at: opened.expiresAt.toISOString(),
  });
  if (insertError) {
    // Without a row the channel can't be stopped or renewed later; don't leave it delivering.
    await client.stopChannel(channelId, opened.resourceId).catch(() => undefined);
    throw new Error(`Failed to save calendar watch channel: ${insertError.message}`);
  }

  let stopped = 0;
  for (const old of active ?? []) {
    try {
      await client.stopChannel(old.channel_id, old.resource_id);
    } catch (e) {
      // Usually "channel not found" because it already expired.
      console.warn(`[calendar-watch] could not stop channel ${old.channel_id}:`, e);
    }
    await supabase
      .from("calendar_watch_channels")
      .update({ stopped_at: now.toISOString() })
      .eq("id", old.id);
    stopped++;
  }

  return { action: "created", channelId, expiresAt: opened.expiresAt.toISOString(), stopped };
}
