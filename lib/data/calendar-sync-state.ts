import type { Db, Row } from "./db";
import type { InMemoryDataset } from "./in-memory";

/** A claim older than this is a sync that died without letting go (the route's maxDuration is 300s). */
export const CLAIM_STALE_MS = 5 * 60 * 1000;

export type CalendarSyncStateRow = Row<"calendar_sync_state">;

/** A Google push-notification channel for a calendar (`calendar_watch_channels`). */
export type WatchChannel = { id: string; channelId: string; resourceId: string; expiresAt: string };

export type SyncClaim = { claimed: true; syncedThrough: Date | null } | { claimed: false };

/**
 * Who is syncing a Google calendar and how far the sync has got (`calendar_sync_state`, one row per
 * calendar): the lease that keeps a burst of change notifications from running overlapping syncs
 * (one running sync plus one rerun), and the watermark the next sync starts from. Each step is a
 * single conditional UPDATE, so two callers can't both win. Local data, service role. Also the
 * push channels Google notifies us through (`calendar_watch_channels`), which the daily renewal keeps alive.
 *
 * The sync-state methods throw `calendar_sync_state: <step>: <database message>` on a database error;
 * the watch channel methods throw the database's message as is.
 */
export interface CalendarSyncStateRepository {
  /**
   * Takes the right to sync this calendar. `{ claimed: true, syncedThrough }` when no other sync holds
   * it (or its claim is older than {@link CLAIM_STALE_MS}); otherwise leaves a note ("run once more")
   * for the one that does and returns `{ claimed: false }`.
   */
  claim(calendarId: string, now: Date): Promise<SyncClaim>;
  /**
   * Lets go of the claim, unless a notification asked for another run meanwhile. True when released;
   * false when a rerun was requested (the claim is kept, the request cleared: run again).
   */
  release(calendarId: string, now: Date): Promise<boolean>;
  /** Lets go after a failure, whatever was requested: the next notification starts from the old watermark. Throws the database's message as is. */
  abandon(calendarId: string): Promise<void>;
  /** Records that everything the calendar changed before `startedAt` is in Bronze (creating the row if there is none). */
  saveSyncedThrough(calendarId: string, startedAt: Date): Promise<void>;
  /** The calendar's push channels that were not stopped, latest expiry first. */
  activeWatchChannels(calendarId: string): Promise<WatchChannel[]>;
  /** Records a channel Google just opened. */
  saveWatchChannel(channel: { calendarId: string; channelId: string; resourceId: string; expiresAt: Date }): Promise<void>;
  /** Marks a channel stopped (kept as history, never deleted). */
  markWatchChannelStopped(id: string, at: Date): Promise<void>;
}

function fail(what: string, error: { message: string }): never {
  throw new Error(`calendar_sync_state: ${what}: ${error.message}`);
}

export class SupabaseCalendarSyncStateRepository implements CalendarSyncStateRepository {
  constructor(private readonly db: Db) {}

  async claim(calendarId: string, now: Date): Promise<SyncClaim> {
    const { error: seedError } = await this.db
      .from("calendar_sync_state")
      .upsert({ calendar_id: calendarId }, { onConflict: "calendar_id", ignoreDuplicates: true });
    if (seedError) fail("create row", seedError);

    const staleBefore = new Date(now.getTime() - CLAIM_STALE_MS).toISOString();
    const { data, error } = await this.db
      .from("calendar_sync_state")
      .update({ running_since: now.toISOString(), rerun_requested: false })
      .eq("calendar_id", calendarId)
      .or(`running_since.is.null,running_since.lt.${staleBefore}`)
      .select("synced_through");
    if (error) fail("claim", error);
    if (data && data.length > 0) {
      const through = data[0].synced_through;
      return { claimed: true, syncedThrough: through ? new Date(through) : null };
    }

    const { error: noteError } = await this.db.from("calendar_sync_state").update({ rerun_requested: true }).eq("calendar_id", calendarId);
    if (noteError) fail("request rerun", noteError);
    return { claimed: false };
  }

  async release(calendarId: string, now: Date) {
    const { data, error } = await this.db
      .from("calendar_sync_state")
      .update({ running_since: null })
      .eq("calendar_id", calendarId)
      .eq("rerun_requested", false)
      .select("calendar_id");
    if (error) fail("release", error);
    if (data && data.length > 0) return true;

    const { error: clearError } = await this.db
      .from("calendar_sync_state")
      .update({ rerun_requested: false, running_since: now.toISOString() })
      .eq("calendar_id", calendarId);
    if (clearError) fail("clear rerun", clearError);
    return false;
  }

  async abandon(calendarId: string) {
    const { error } = await this.db.from("calendar_sync_state").update({ running_since: null }).eq("calendar_id", calendarId);
    if (error) throw new Error(error.message);
  }

  async saveSyncedThrough(calendarId: string, startedAt: Date) {
    const { error } = await this.db
      .from("calendar_sync_state")
      .upsert({ calendar_id: calendarId, synced_through: startedAt.toISOString() }, { onConflict: "calendar_id" });
    if (error) fail("save watermark", error);
  }

  async activeWatchChannels(calendarId: string) {
    const { data, error } = await this.db
      .from("calendar_watch_channels")
      .select("id, channel_id, resource_id, expires_at")
      .eq("calendar_id", calendarId)
      .is("stopped_at", null)
      .order("expires_at", { ascending: false })
      .order("id");
    if (error) throw new Error(error.message);
    return (data ?? []).map((c) => ({ id: c.id, channelId: c.channel_id, resourceId: c.resource_id, expiresAt: c.expires_at }));
  }

  async saveWatchChannel(channel: { calendarId: string; channelId: string; resourceId: string; expiresAt: Date }) {
    const { error } = await this.db.from("calendar_watch_channels").insert({
      calendar_id: channel.calendarId,
      channel_id: channel.channelId,
      resource_id: channel.resourceId,
      expires_at: channel.expiresAt.toISOString(),
    });
    if (error) throw new Error(error.message);
  }

  async markWatchChannelStopped(id: string, at: Date) {
    const { error } = await this.db.from("calendar_watch_channels").update({ stopped_at: at.toISOString() }).eq("id", id);
    if (error) throw new Error(error.message);
  }
}

export class InMemoryCalendarSyncStateRepository implements CalendarSyncStateRepository {
  constructor(private readonly data: InMemoryDataset) {}

  private row(calendarId: string): CalendarSyncStateRow | undefined {
    return this.data.calendarSyncStates.find((r) => r.calendar_id === calendarId);
  }

  async claim(calendarId: string, now: Date): Promise<SyncClaim> {
    let row = this.row(calendarId);
    if (!row) {
      row = { calendar_id: calendarId, rerun_requested: false, running_since: null, synced_through: null };
      this.data.calendarSyncStates.push(row);
    }
    const staleBefore = now.getTime() - CLAIM_STALE_MS;
    if (row.running_since === null || Date.parse(row.running_since) < staleBefore) {
      row.running_since = now.toISOString();
      row.rerun_requested = false;
      return { claimed: true, syncedThrough: row.synced_through ? new Date(row.synced_through) : null };
    }
    row.rerun_requested = true;
    return { claimed: false };
  }

  async release(calendarId: string, now: Date) {
    const row = this.row(calendarId);
    if (!row) return false;
    if (!row.rerun_requested) {
      row.running_since = null;
      return true;
    }
    row.rerun_requested = false;
    row.running_since = now.toISOString();
    return false;
  }

  async abandon(calendarId: string) {
    const row = this.row(calendarId);
    if (row) row.running_since = null;
  }

  async saveSyncedThrough(calendarId: string, startedAt: Date) {
    const row = this.row(calendarId);
    if (row) row.synced_through = startedAt.toISOString();
    else this.data.calendarSyncStates.push({ calendar_id: calendarId, rerun_requested: false, running_since: null, synced_through: startedAt.toISOString() });
  }

  async activeWatchChannels(calendarId: string) {
    return this.data.calendarWatchChannels
      .filter((c) => c.calendar_id === calendarId && c.stopped_at === null)
      .sort((a, b) => (a.expires_at < b.expires_at ? 1 : a.expires_at > b.expires_at ? -1 : a.id < b.id ? -1 : 1))
      .map((c) => ({ id: c.id, channelId: c.channel_id, resourceId: c.resource_id, expiresAt: c.expires_at }));
  }

  async saveWatchChannel(channel: { calendarId: string; channelId: string; resourceId: string; expiresAt: Date }) {
    if (this.data.calendarWatchChannels.some((c) => c.channel_id === channel.channelId)) {
      throw new Error('duplicate key value violates unique constraint "calendar_watch_channels_channel_id_key"');
    }
    this.data.calendarWatchChannels.push({
      id: `cwch_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`,
      calendar_id: channel.calendarId,
      channel_id: channel.channelId,
      resource_id: channel.resourceId,
      expires_at: channel.expiresAt.toISOString(),
      stopped_at: null,
      created_at: new Date().toISOString(),
    });
  }

  async markWatchChannelStopped(id: string, at: Date) {
    const channel = this.data.calendarWatchChannels.find((c) => c.id === id);
    if (channel) channel.stopped_at = at.toISOString();
  }
}
