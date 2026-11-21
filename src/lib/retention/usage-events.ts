import type { SupabaseClient } from "@supabase/supabase-js";
import { clock } from "@/lib/clock";
import { ORG_TIMEZONE } from "@/lib/config";
import { RETENTION } from "@/lib/retention";

/**
 * The nightly job behind "usage statistics are kept for `RETENTION.usageMonths` months, then only anonymous
 * totals remain" (/privacy). Two steps, through the database functions in 20270320000000_analytics_rollups.sql:
 *
 * 1. **Roll up.** Every completed day, week (starting Sunday) and month of the organisation's calendar that has
 *    usage events and no rollup yet is counted into `analytics_rollups` (events, visits and members per event,
 *    route, control, action, browser, OS, device type and viewport; no ids). A period counts as completed two
 *    days after it ends, because a client may send an event up to a day late. Recomputing a period replaces it.
 * 2. **Remove old events.** Events caused by the app's users (source `client` or `server`) older than the retention
 *    period are removed, but only where their day, week and month are all rolled up, so no event goes before its
 *    totals are kept. The app's own records (source `system`, today `notification_sent`) are never removed here.
 *
 * Idempotent, and safe to stop at any point: a run that hits its time budget leaves the rest for tomorrow's. The
 * first events reach the retention period in late 2027, so until then the second step finds nothing.
 */

export const USAGE_RETENTION_BUDGET_MS = 240_000;
const ROWS_PER_BATCH = 5000;

export interface UsageRetentionResult {
  /** Periods rolled up by kind, and the rollup rows written. */
  rolledUp: { day: number; week: number; month: number; rows: number };
  /** Usage events removed because they were past the retention period and already rolled up. */
  pruned: number;
  /** True when the time budget ran out; the rest is picked up on the next run. */
  stoppedEarly: boolean;
}

/** `months` calendar months before `now`, in UTC (the cutoff is an instant; whole days are decided in the database). */
export function monthsBefore(now: number, months: number): Date {
  const d = new Date(now);
  d.setUTCMonth(d.getUTCMonth() - months);
  return d;
}

export async function rollUpAndPruneUsageEvents(
  db: SupabaseClient,
  { budgetMs = USAGE_RETENTION_BUDGET_MS }: { budgetMs?: number } = {}
): Promise<UsageRetentionResult> {
  const startedAt = clock.now();
  const outOfTime = () => clock.now() - startedAt >= budgetMs;
  const result: UsageRetentionResult = { rolledUp: { day: 0, week: 0, month: 0, rows: 0 }, pruned: 0, stoppedEarly: false };

  // 1. Roll up what is complete and not yet counted.
  const { data: periods, error } = await db.rpc("analytics_unrolled_periods", { p_tz: ORG_TIMEZONE, p_now: new Date(clock.now()).toISOString() });
  if (error) throw new Error(`analytics_unrolled_periods: ${error.message}`);
  for (const period of (periods ?? []) as { period_kind: "day" | "week" | "month"; period_start: string }[]) {
    if (outOfTime()) return { ...result, stoppedEarly: true };
    const { data: rows, error: rollError } = await db.rpc("analytics_rollup_period", {
      p_kind: period.period_kind,
      p_start: period.period_start,
      p_tz: ORG_TIMEZONE,
    });
    if (rollError) throw new Error(`analytics_rollup_period(${period.period_kind} ${period.period_start}): ${rollError.message}`);
    result.rolledUp[period.period_kind] += 1;
    result.rolledUp.rows += Number(rows ?? 0);
  }

  // 2. Remove events past the retention period whose totals are kept.
  const cutoff = monthsBefore(clock.now(), RETENTION.usageMonths).toISOString();
  for (;;) {
    if (outOfTime()) return { ...result, stoppedEarly: true };
    const { data, error: pruneError } = await db.rpc("analytics_prune_usage_events", { p_cutoff: cutoff, p_tz: ORG_TIMEZONE, p_limit: ROWS_PER_BATCH });
    if (pruneError) throw new Error(`analytics_prune_usage_events: ${pruneError.message}`);
    const n = Number(data ?? 0);
    if (n === 0) break;
    result.pruned += n;
  }
  return result;
}
