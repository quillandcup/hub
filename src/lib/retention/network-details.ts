import type { SupabaseClient } from "@supabase/supabase-js";
import { clock } from "@/lib/clock";
import { parseDevice } from "@/lib/device";
import type { DeviceInfo } from "@/lib/device-label";
import { RETENTION } from "@/lib/retention";

/**
 * The nightly job behind "your exact IP address and your browser's identification string are removed after
 * `RETENTION.rawNetworkDays` days, keeping the approximate place and the type of browser and device" (/privacy).
 * Two steps, in this order, each in batches through the database functions in
 * 20270309000000_retention_network_details.sql:
 *
 * 1. **Keep the device.** Every distinct user-agent string that has no parsed device yet is parsed once and its
 *    result stored on its rows (`access_events`, `video_watch_segments`); in a usage event's context the parsed
 *    fields replace the raw string, at any age. A string with nothing readable stores `{}`, so it is not looked
 *    at again.
 * 2. **Remove the raw values** from rows older than the retention period: the exact IP and the user agent from
 *    `access_events`, the user agent from `video_watch_segments`, but a user agent only where the device is
 *    already stored, so nothing is lost before its browser and device are kept. The place (country, region, city)
 *    is not touched.
 *
 * Idempotent, and safe to stop at any point: a run that hits its time budget leaves the rest for tomorrow's.
 */

export const NETWORK_RETENTION_BUDGET_MS = 240_000;
const PENDING_STRINGS_PER_PAGE = 500;
const ROWS_PER_BATCH = 5000;

const DEVICE_SOURCES = ["access_events", "video_watch_segments", "analytics_events"] as const;
type DeviceSource = (typeof DEVICE_SOURCES)[number];

export interface NetworkRetentionResult {
  /** Rows given a stored device (or, for usage events, a context without the raw string), by table. */
  devicesStored: Record<DeviceSource, number>;
  /** Rows whose raw IP and/or user agent were removed, by table. */
  removed: { access_events: number; video_watch_segments: number };
  /** True when the time budget ran out; the rest is picked up on the next run. */
  stoppedEarly: boolean;
}

/** What goes into a usage event's context in place of the raw string: only the parts that were read. */
function contextFields(device: DeviceInfo | null): Record<string, string> {
  const out: Record<string, string> = {};
  if (device?.browser) out.browser = device.browser;
  if (device?.browser_version) out.browser_version = device.browser_version;
  if (device?.os) out.os = device.os;
  if (device?.os_version) out.os_version = device.os_version;
  if (device?.device_type) out.device_type = device.device_type;
  return out;
}

export async function enforceNetworkRetention(
  db: SupabaseClient,
  { budgetMs = NETWORK_RETENTION_BUDGET_MS }: { budgetMs?: number } = {}
): Promise<NetworkRetentionResult> {
  const startedAt = clock.now();
  const outOfTime = () => clock.now() - startedAt >= budgetMs;
  const result: NetworkRetentionResult = {
    devicesStored: { access_events: 0, video_watch_segments: 0, analytics_events: 0 },
    removed: { access_events: 0, video_watch_segments: 0 },
    stoppedEarly: false,
  };

  // 1. Keep the device.
  for (const source of DEVICE_SOURCES) {
    for (;;) {
      if (outOfTime()) return { ...result, stoppedEarly: true };
      const { data: pending, error } = await db.rpc("retention_pending_user_agents", { p_source: source, p_limit: PENDING_STRINGS_PER_PAGE });
      if (error) throw new Error(`retention_pending_user_agents(${source}): ${error.message}`);
      const strings = (pending ?? []) as string[];
      if (strings.length === 0) break;

      for (const userAgent of strings) {
        const device = parseDevice(userAgent);
        const payload = source === "analytics_events" ? contextFields(device) : (device ?? {});
        for (;;) {
          if (outOfTime()) return { ...result, stoppedEarly: true };
          const { data: changed, error: setError } = await db.rpc("retention_set_device", {
            p_source: source,
            p_user_agent: userAgent,
            p_device: payload,
            p_limit: ROWS_PER_BATCH,
          });
          if (setError) throw new Error(`retention_set_device(${source}): ${setError.message}`);
          const n = Number(changed ?? 0);
          if (n === 0) break;
          result.devicesStored[source] += n;
        }
      }
    }
  }

  // 2. Remove the raw values once they are old enough.
  const cutoff = new Date(clock.now() - RETENTION.rawNetworkDays * 24 * 60 * 60 * 1000).toISOString();
  for (;;) {
    if (outOfTime()) return { ...result, stoppedEarly: true };
    const { data, error } = await db.rpc("retention_remove_raw_network", { p_cutoff: cutoff, p_limit: ROWS_PER_BATCH });
    if (error) throw new Error(`retention_remove_raw_network: ${error.message}`);
    let any = 0;
    for (const row of (data ?? []) as { source: keyof NetworkRetentionResult["removed"]; removed: number }[]) {
      result.removed[row.source] += row.removed;
      any += row.removed;
    }
    if (any === 0) break;
  }
  return result;
}
