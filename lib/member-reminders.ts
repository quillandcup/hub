import type { SupabaseClient } from "@supabase/supabase-js";
import { APP_URL, ATTENDANCE_DATA_STARTS_ON, ORG_TIMEZONE, SLACK_INTRO_CHANNEL, SLACK_WORKSPACE_URL } from "@/lib/config";
import { createNotifier } from "@/lib/notifications/notify";
import type { NotificationKindId } from "@/lib/notifications/registry";
import { resolveInAppNotifications } from "@/lib/channels/in-app";
import { daysSinceJoined, isNewcomer } from "@/lib/newcomer";
import { resolveSlackUserIds } from "@/lib/slack-member-ids";
import { loadIntroChannelId, loadIntroducedMemberIds, loadLastAttendanceByMember } from "@/lib/newcomer-signals";
import { loadCalendarPrickleIdsByMember } from "@/lib/prickle-checkin-dms";
import type { OutboundMessage } from "@/lib/channels";
import { calendarDaysBetween, currentHour, jitteredGapDays, sendHourFor } from "@/lib/nudge-jitter";
import { isValidTimeZone } from "@/lib/time-zone";

/**
 * Two kinds of reminder, sent by the hourly /api/internal/member-reminders:
 * It runs hourly. Each reminder goes out in an hour of its own (9am to 6pm in the member's timezone,
 * from their Settings; the org timezone when they haven't set one) after a
 * gap nudged a day or so either way, both worked out from the member and how many they've had, so
 * nothing lands in one blast, at the same time of day or on a fixed weekday (lib/nudge-jitter.ts).
 * - intro_nudge: a newcomer (lib/newcomer.ts) hasn't introduced themselves in the intro channel.
 *   Weekly, a few times, then it stops: Slack history only reaches back that far anyway. Only for
 *   members we've matched to a Slack user; for anyone else we couldn't see an introduction.
 * - prickle_nudge: an active member has no prickle on their calendar and hasn't attended one lately.
 *   It never stops while they're a member, but backs off the longer it goes unanswered, and starts
 *   over after they attend. It's "schedule your first prickle" for a recent joiner who has never
 *   been, "we miss you" for someone who used to come, and "your next prickle" for anyone we can't
 *   tell (joined before attendance was recorded).
 * The Getting started tour's two newcomer steps (lib/onboarding.ts) read the same signals.
 */

export type MemberReminderKind = Extract<NotificationKindId, "intro_nudge" | "prickle_nudge">;

export interface NudgeSchedule {
  /** Days after joining before the first reminder (the welcome emails already say it on day one). */
  firstAfterDays: number;
  /** Days to wait after the `sent`th reminder (counting those since the member last did the thing). */
  gapDays: (sent: number) => number;
  /** Stop after this many; unset = never stop. */
  max?: number;
}

export const INTRO_SCHEDULE: NudgeSchedule = { firstAfterDays: 2, gapDays: () => 7, max: 4 };
/** Weekly for the first four, then every two weeks for four, then monthly. */
export const PRICKLE_SCHEDULE: NudgeSchedule = {
  firstAfterDays: 2,
  gapDays: (sent) => (sent < 4 ? 7 : sent < 8 ? 14 : 30),
};

/** Not attended within this many days counts as lapsed (and, with nothing upcoming, gets a reminder). */
export const PRICKLE_LAPSED_AFTER_DAYS = 30;

/** `ref` on the in-app notification, so it can be marked read once the member has done it. */
const NUDGE_REF: Record<MemberReminderKind, string> = { intro_nudge: "intro", prickle_nudge: "prickle" };

const DAY_MS = 24 * 60 * 60 * 1000;
const BATCH_SIZE = 1000;

/**
 * Whether a reminder is due. `sentAt` is when earlier ones went out, since the member last did the
 * thing (so attending resets the backoff). `jitterKey` (member id + kind) shifts the gap.
 */
export function nudgeDue(
  schedule: NudgeSchedule,
  daysSinceJoin: number | null,
  sentAt: Date[],
  now: Date,
  jitterKey = "",
  timeZone: string = ORG_TIMEZONE
): boolean {
  if (daysSinceJoin === null || daysSinceJoin < schedule.firstAfterDays) return false;
  if (schedule.max !== undefined && sentAt.length >= schedule.max) return false;
  if (sentAt.length === 0) return true;
  const last = Math.max(...sentAt.map((d) => d.getTime()));
  const gap = jitteredGapDays(schedule.gapDays(sentAt.length), `${jitterKey}:${sentAt.length}`);
  return calendarDaysBetween(new Date(last), now, timeZone) >= gap;
}

export type PrickleNudgeVariant = "first" | "lapsed" | "next";

/**
 * Which wording: "first" only when we can see the member's whole history (joined since attendance
 * has been recorded) and they've never attended; "lapsed" for someone who has; otherwise "next",
 * so a long-time member who's been away isn't told it's their first.
 */
export function prickleNudgeVariant(firstJoinedAt: string | null, lastAttendance: Date | null): PrickleNudgeVariant {
  if (lastAttendance) return "lapsed";
  if (firstJoinedAt && firstJoinedAt >= ATTENDANCE_DATA_STARTS_ON) return "first";
  return "next";
}

export function introNudgeMessage(channelId: string | null): OutboundMessage {
  return {
    title: `Say hello in #${SLACK_INTRO_CHANNEL}`,
    text: `Say hello in #${SLACK_INTRO_CHANNEL}! A few lines about what you write and what you're working on is plenty, and it's the easiest way to meet other Hedgies.`,
    url: channelId ? `${SLACK_WORKSPACE_URL}/app_redirect?channel=${channelId}` : undefined,
    linkLabel: `Open #${SLACK_INTRO_CHANNEL} in Slack`,
    ref: NUDGE_REF.intro_nudge,
  };
}

const PRICKLE_NUDGE_TEXT: Record<PrickleNudgeVariant, string> = {
  first:
    "You don't have a prickle on your calendar yet. Pick one for your first writing session and add it. If you miss it, pick another!",
  lapsed: "We miss writing with you! Find your next prickle and put it on your calendar.",
  next: "Ready for your next prickle? Find one that fits your week and add it to your calendar.",
};

const PRICKLE_NUDGE_TITLE: Record<PrickleNudgeVariant, string> = {
  first: "Schedule your first prickle",
  lapsed: "We miss you at prickles",
  next: "Find your next prickle",
};

export function prickleNudgeMessage(variant: PrickleNudgeVariant): OutboundMessage {
  return { title: PRICKLE_NUDGE_TITLE[variant], text: PRICKLE_NUDGE_TEXT[variant], url: `${APP_URL}/my-prickles`, ref: NUDGE_REF.prickle_nudge };
}

interface MemberRow {
  id: string;
  first_joined_at: string | null;
  user_id: string | null;
}

async function loadActiveMembers(supabase: SupabaseClient): Promise<MemberRow[]> {
  const rows: MemberRow[] = [];
  let offset = 0;
  let hasMore = true;
  while (hasMore) {
    const { data } = await supabase
      .from("members")
      .select("id, first_joined_at, user_id")
      .eq("status", "active")
      .order("id")
      .range(offset, offset + BATCH_SIZE - 1);
    if (data && data.length > 0) {
      rows.push(...(data as MemberRow[]));
      offset += data.length;
      hasMore = data.length === BATCH_SIZE;
    } else {
      hasMore = false;
    }
  }
  return rows;
}

/** Whether this is the hour the member's next reminder (the `sent + 1`th) goes out in. */
const isSendHour = (memberId: string, kind: MemberReminderKind, sent: number, now: Date, timeZone: string) =>
  currentHour(now, timeZone) === sendHourFor(`${memberId}:${kind}:${sent}`);

/**
 * memberId -> the timezone they chose in Settings (user_profiles.timezone_preference), for those
 * who chose one. "browser" (auto-detect) isn't a place we can name, so those members, and anyone
 * without an account yet, are left out and get the org timezone. Kajabi's API has no timezone for
 * a contact (only a mostly-empty address), so there's nothing to fall back on there.
 */
async function loadMemberTimeZones(supabase: SupabaseClient, members: MemberRow[]): Promise<Map<string, string>> {
  const zones = new Map<string, string>();
  const withAccount = members.filter((m) => m.user_id);
  for (let i = 0; i < withAccount.length; i += 200) {
    const chunk = withAccount.slice(i, i + 200);
    const { data } = await supabase
      .from("user_profiles")
      .select("id, timezone_preference")
      .in("id", chunk.map((m) => m.user_id as string));
    const zoneByUser = new Map((data ?? []).map((p) => [p.id as string, p.timezone_preference as string | null]));
    for (const m of chunk) {
      const zone = zoneByUser.get(m.user_id as string);
      if (isValidTimeZone(zone)) zones.set(m.id, zone);
    }
  }
  return zones;
}

/** `${memberId}:${kind}` -> when each reminder went out. */
async function loadNudgeLog(supabase: SupabaseClient, memberIds: string[]): Promise<Map<string, Date[]>> {
  const log = new Map<string, Date[]>();
  for (let i = 0; i < memberIds.length; i += 200) {
    let offset = 0;
    let hasMore = true;
    while (hasMore) {
      const { data } = await supabase
        .from("member_reminder_log")
        .select("member_id, kind, sent_at")
        .in("member_id", memberIds.slice(i, i + 200))
        .order("id")
        .range(offset, offset + BATCH_SIZE - 1);
      for (const row of data ?? []) {
        const key = `${row.member_id}:${row.kind}`;
        log.set(key, [...(log.get(key) ?? []), new Date(row.sent_at)]);
      }
      offset += data?.length ?? 0;
      hasMore = (data?.length ?? 0) === BATCH_SIZE;
    }
  }
  return log;
}

/** Claims today's reminder for the member; false when another run already did (unique member, kind, day). */
async function tryRecordNudge(supabase: SupabaseClient, memberId: string, kind: MemberReminderKind, now: Date) {
  const { data, error } = await supabase
    .from("member_reminder_log")
    .insert({ member_id: memberId, kind, sent_at: now.toISOString(), sent_on: now.toISOString().slice(0, 10) })
    .select("id");
  if (error) {
    if (error.code !== "23505") console.error(`tryRecordNudge failed for member=${memberId} kind=${kind}:`, error);
    return false;
  }
  return (data?.length ?? 0) > 0;
}

export interface MemberReminderResult {
  /** Reminders sent for real. */
  intro: number;
  prickle: number;
  /** Reminders that would have been sent to members this isn't switched on for (see MemberReminderOptions.liveFor). */
  dryRun: { intro: number; prickle: number };
}

export interface MemberReminderOptions {
  /**
   * Which of these members get their reminders for real; the rest are dry-run: logged (member id,
   * kind, why, channels, message) but never sent, recorded or marked, so switching them on later
   * starts from a clean slate. Per kind, so one can be live while the other only logs; the route uses the
   * `intro_reminders` and `prickle_reminders` feature flags. Default:
   * everyone.
   */
  liveFor?: (kind: MemberReminderKind, memberIds: string[]) => Promise<Set<string>>;
}

/**
 * One pass: sends whichever reminders are due, and marks earlier in-app ones read for members who've
 * since done the thing.
 */
export async function sendMemberReminders(
  supabase: SupabaseClient,
  now: Date = new Date(),
  { liveFor = async (_kind, ids) => new Set(ids) }: MemberReminderOptions = {}
): Promise<MemberReminderResult> {
  const members = await loadActiveMembers(supabase);
  if (members.length === 0) return { intro: 0, prickle: 0, dryRun: { intro: 0, prickle: 0 } };
  const memberIds = members.map((m) => m.id);
  // Each kind has its own switch, so intro reminders can go out for real before prickle reminders do.
  const [introLive, prickleLive] = await Promise.all([liveFor("intro_nudge", memberIds), liveFor("prickle_nudge", memberIds)]);
  const newcomers = members.filter((m) => isNewcomer(m.first_joined_at, now));

  const [introduced, lastAttendance, log, channelId, zones] = await Promise.all([
    loadIntroducedMemberIds(supabase, newcomers.map((m) => m.id)),
    loadLastAttendanceByMember(supabase, memberIds),
    loadNudgeLog(supabase, memberIds),
    loadIntroChannelId(supabase),
    loadMemberTimeZones(supabase, members),
  ]);
  const zoneOf = (memberId: string) => zones.get(memberId) ?? ORG_TIMEZONE;
  const sentFor = (memberId: string, kind: MemberReminderKind) => log.get(`${memberId}:${kind}`) ?? [];
  const lapsedBefore = new Date(now.getTime() - PRICKLE_LAPSED_AFTER_DAYS * DAY_MS);
  const attendedRecently = (memberId: string) => {
    const last = lastAttendance.get(memberId);
    return !!last && last >= lapsedBefore;
  };

  // Anything we already asked in-app is no longer pending once they've done it.
  // Only for members this is live for: a dry run leaves everything as it was.
  for (const m of newcomers.filter((m) => introLive.has(m.id))) {
    if (introduced.has(m.id) && sentFor(m.id, "intro_nudge").length > 0) {
      await resolveInAppNotifications(supabase, m.id, "intro_nudge", NUDGE_REF.intro_nudge);
    }
  }
  for (const m of members.filter((m) => prickleLive.has(m.id))) {
    if (attendedRecently(m.id) && sentFor(m.id, "prickle_nudge").length > 0) {
      await resolveInAppNotifications(supabase, m.id, "prickle_nudge", NUDGE_REF.prickle_nudge);
    }
  }

  const introDue = newcomers.filter(
    (m) =>
      !introduced.has(m.id) &&
      isSendHour(m.id, "intro_nudge", sentFor(m.id, "intro_nudge").length, now, zoneOf(m.id)) &&
      nudgeDue(INTRO_SCHEDULE, daysSinceJoined(m.first_joined_at, now), sentFor(m.id, "intro_nudge"), now, `${m.id}:intro_nudge`, zoneOf(m.id))
  );
  const prickleDue = members.filter((m) => {
    if (attendedRecently(m.id)) return false;
    // Reminders count from the last time they attended, so coming back starts the backoff over.
    const last = lastAttendance.get(m.id);
    const since = sentFor(m.id, "prickle_nudge").filter((d) => !last || d > last);
    if (!isSendHour(m.id, "prickle_nudge", since.length, now, zoneOf(m.id))) return false;
    return nudgeDue(PRICKLE_SCHEDULE, daysSinceJoined(m.first_joined_at, now), since, now, `${m.id}:prickle_nudge`, zoneOf(m.id));
  });

  // We can't tell whether someone we haven't matched to a Slack user has posted, so leave them be.
  const inSlack = introDue.length > 0 ? await resolveSlackUserIds(supabase, introDue.map((m) => m.id)) : new Map();
  const intro = await sendKind(
    supabase,
    "intro_nudge",
    introDue.filter((m) => inSlack.has(m.id)),
    now,
    () => introNudgeMessage(channelId),
    undefined,
    introLive,
    (m) => ({
      daysSinceJoined: daysSinceJoined(m.first_joined_at, now),
      remindersSentBefore: sentFor(m.id, "intro_nudge").length,
      postedInIntroChannel: false,
      matchedToSlackUser: true,
      sendHour: sendHourFor(`${m.id}:intro_nudge:${sentFor(m.id, "intro_nudge").length}`),
      timeZone: zoneOf(m.id),
    })
  );
  const prickle = await sendKind(
    supabase,
    "prickle_nudge",
    prickleDue,
    now,
    (m) => prickleNudgeMessage(prickleNudgeVariant(m.first_joined_at, lastAttendance.get(m.id) ?? null)),
    async (candidates) => {
      // Someone with a prickle coming up has what we'd ask for. Checked last: each calendar is a
      // handful of queries.
      const upcoming = await loadCalendarPrickleIdsByMember(supabase, candidates.map((m) => m.id), now, now);
      return candidates.filter((m) => (upcoming.get(m.id)?.size ?? 0) === 0);
    },
    prickleLive,
    (m) => {
      const last = lastAttendance.get(m.id) ?? null;
      const since = sentFor(m.id, "prickle_nudge").filter((d) => !last || d > last);
      return {
        variant: prickleNudgeVariant(m.first_joined_at, last),
        daysSinceJoined: daysSinceJoined(m.first_joined_at, now),
        lastAttended: last ? last.toISOString().slice(0, 10) : null,
        remindersSinceLastAttended: since.length,
        nothingOnCalendar: true,
        sendHour: sendHourFor(`${m.id}:prickle_nudge:${since.length}`),
        timeZone: zoneOf(m.id),
      };
    }
  );
  const dryRun = { intro: intro.dryRun, prickle: prickle.dryRun };
  if (dryRun.intro + dryRun.prickle > 0) {
    console.log("[member-reminders] dry run: not sent or recorded", dryRun);
  }
  return { intro: intro.sent, prickle: prickle.sent, dryRun };
}

async function sendKind(
  supabase: SupabaseClient,
  kind: MemberReminderKind,
  due: MemberRow[],
  now: Date,
  messageFor: (member: MemberRow) => OutboundMessage,
  narrow: (candidates: MemberRow[]) => Promise<MemberRow[]> = async (c) => c,
  live: Set<string>,
  why: (member: MemberRow) => Record<string, unknown>
): Promise<{ sent: number; dryRun: number }> {
  if (due.length === 0) return { sent: 0, dryRun: 0 };
  const notifier = await createNotifier(supabase, kind, due.map((m) => m.id));

  // Members this isn't live for are only logged, whether or not they'd be reachable, so the log
  // shows who a real run would skip (not opted in, or opted out) as well as who it would remind.
  let dryRun = 0;
  for (const member of await narrow(due.filter((m) => !live.has(m.id)))) {
    const channels = notifier.channelsFor(member.id);
    const message = messageFor(member);
    if (channels.length > 0) dryRun++;
    console.log(
      `[member-reminders] DRY RUN ${kind}`,
      JSON.stringify({
        memberId: member.id,
        wouldSend: channels.length > 0,
        channels,
        why: why(member),
        text: message.text,
        url: message.url ?? null,
      })
    );
  }

  // Opted out everywhere, or no address: not logged, so turning it on later still sends one.
  const reachable = await narrow(due.filter((m) => live.has(m.id) && notifier.canReach(m.id)));
  let sent = 0;
  for (const member of reachable) {
    const message = messageFor(member);
    if (!(await tryRecordNudge(supabase, member.id, kind, now))) continue;
    const delivered = await notifier.send(member.id, message);
    if (delivered.length > 0) sent++;
    else {
      // Keep partial successes deduplicated; only a completely undelivered reminder can retry.
      const { error } = await supabase
        .from("member_reminder_log")
        .delete()
        .eq("member_id", member.id)
        .eq("kind", kind)
        .eq("sent_on", now.toISOString().slice(0, 10));
      if (error) throw new Error(`Releasing ${kind} notification claim failed: ${error.message}`);
    }
  }
  return { sent, dryRun };
}
