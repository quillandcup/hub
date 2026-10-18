import type { SupabaseClient } from "@supabase/supabase-js";
import { zonedTimeToUtc } from "@/lib/prickle-schedules";
import { localDateOf } from "@/lib/prickle-writing";

/**
 * How to get into the prickle Zoom room: the one-click link and the passcode. Admins set them at
 * /admin/prickle-join (prickle_join_settings, append-only) when the passcode changes; a prickle uses
 * the setting in effect at its start, so a change applies going forward.
 */
export interface PrickleJoin {
  url: string;
  passcode: string | null;
}

export interface PrickleJoinSetting extends PrickleJoin {
  id: string;
  effectiveFrom: string;
  createdAt: string;
}

/** Newest first. A handful of rows over the years, so no pagination. */
export async function loadPrickleJoinSettings(supabase: SupabaseClient): Promise<PrickleJoinSetting[]> {
  const { data, error } = await supabase
    .from("prickle_join_settings")
    .select("id, join_url, passcode, effective_from, created_at")
    .order("effective_from", { ascending: false })
    // Two rows for the same instant (a correction): the one saved last wins.
    .order("created_at", { ascending: false });
  if (error) {
    console.error("loadPrickleJoinSettings failed", error);
    return [];
  }
  return (data ?? []).map((r) => ({
    id: r.id,
    url: r.join_url,
    passcode: r.passcode,
    effectiveFrom: r.effective_from,
    createdAt: r.created_at,
  }));
}

/** The setting in effect at `at` (newest-first `settings`), or null when none is yet. */
export function joinAt(settings: PrickleJoinSetting[], at: Date | string = new Date()): PrickleJoin | null {
  const time = new Date(at).getTime();
  const found = settings.find((s) => new Date(s.effectiveFrom).getTime() <= time);
  return found ? { url: found.url, passcode: found.passcode } : null;
}

/** Slack blocks for the join link (a button plus the passcode), or none without a link. */
export function joinSlackBlocks(join: PrickleJoin | null): any[] {
  if (!join) return [];
  return [
    {
      type: "actions",
      elements: [{ type: "button", text: { type: "plain_text", text: "Join the prickle on Zoom" }, url: join.url }],
    },
    ...(join.passcode
      ? [{ type: "context", elements: [{ type: "mrkdwn", text: `Passcode: ${join.passcode}` }] }]
      : []),
  ];
}

/** Calendar-event text for the join details, or "" without a link. */
export function joinDescription(join: PrickleJoin | null): string {
  if (!join) return "";
  return `Join on Zoom: ${join.url}${join.passcode ? `\nPasscode: ${join.passcode}` : ""}`;
}

/** The instant a change dated `date` (YYYY-MM-DD) takes effect: that day's start in `timeZone`. */
export function effectiveFromForDate(date: string, timeZone: string): Date {
  return zonedTimeToUtc(date, "00:00", timeZone);
}

/**
 * Validates an admin's chosen start day: a real YYYY-MM-DD strictly after today in `timeZone`
 * (blank means "right now", handled by the caller). Today or earlier is refused so a change can
 * never rewrite prickles that already ran or are running under the old link.
 */
export function isFutureDate(date: string, now: Date, timeZone: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date))) return false;
  return date > localDateOf(now.toISOString(), timeZone);
}

/** Adds `days` to a YYYY-MM-DD date (calendar arithmetic, no time zone involved). */
function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** The day after today in `timeZone`: the earliest start day an admin can schedule. */
export function tomorrowIn(now: Date, timeZone: string): string {
  return addDays(localDateOf(now.toISOString(), timeZone), 1);
}

/** The first day of next month in `timeZone`: the default start day, since the passcode changes monthly. */
export function firstOfNextMonth(now: Date, timeZone: string): string {
  const [year, month] = localDateOf(now.toISOString(), timeZone).split("-").map(Number);
  return month === 12 ? `${year + 1}-01-01` : `${year}-${String(month + 1).padStart(2, "0")}-01`;
}
