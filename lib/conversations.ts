import { CONVERSATION_QUIET_DAYS, ORG_TIMEZONE } from "@/lib/config";

/**
 * Conversations: the community manager's ongoing reach-outs to members (docs/CONVERSATIONS.md). Plain module (no server
 * imports), so the page, its client components and the repository's twin share the sets and the status rule.
 */

/** Why a conversation was opened. Not "check-in" alone: that name belongs to the prickle mood check-ins. */
export const CONVERSATION_REASONS = ["hello", "welcome", "check_in", "writing_check_in", "encouragement", "other"] as const;
export type ConversationReason = (typeof CONVERSATION_REASONS)[number];

export const CONVERSATION_REASON_LABELS: Record<ConversationReason, string> = {
  hello: "A hello",
  welcome: "A welcome",
  check_in: "A check-in",
  writing_check_in: "A writing check-in",
  encouragement: "Encouragement",
  other: "Something else",
};

/** Where it happens. */
export const CONVERSATION_CHANNELS = ["slack_dm", "prickle", "email", "other"] as const;
export type ConversationChannel = (typeof CONVERSATION_CHANNELS)[number];

export const CONVERSATION_CHANNEL_LABELS: Record<ConversationChannel, string> = {
  slack_dm: "Slack DM",
  prickle: "In a prickle",
  email: "Email",
  other: "Somewhere else",
};

/** How it ended. */
export const CONVERSATION_OUTCOMES = ["re_engaged", "no_response", "declined", "resolved", "other"] as const;
export type ConversationOutcome = (typeof CONVERSATION_OUTCOMES)[number];

export const CONVERSATION_OUTCOME_LABELS: Record<ConversationOutcome, string> = {
  re_engaged: "Came back",
  no_response: "No response",
  declined: "Not interested",
  resolved: "Sorted out",
  other: "Something else",
};

/** How many days back the list shows closed conversations. */
export const CONVERSATION_RECENT_CLOSED_DAYS = 30;

/** The database's length limits on the two free-text fields (CHECK constraints in 20270624000000). */
export const CONVERSATION_NOTES_MAX = 1000;
export const CONVERSATION_NEXT_STEP_MAX = 280;

/** Who wrote a message she is logging. */
export const MESSAGE_DIRECTIONS = ["member", "staff"] as const;
export type MessageDirection = (typeof MESSAGE_DIRECTIONS)[number];

export function isConversationReason(value: unknown): value is ConversationReason {
  return typeof value === "string" && (CONVERSATION_REASONS as readonly string[]).includes(value);
}
export function isConversationChannel(value: unknown): value is ConversationChannel {
  return typeof value === "string" && (CONVERSATION_CHANNELS as readonly string[]).includes(value);
}
export function isConversationOutcome(value: unknown): value is ConversationOutcome {
  return typeof value === "string" && (CONVERSATION_OUTCOMES as readonly string[]).includes(value);
}
/**
 * Whether a string looks like a conversation id (`conv_` and 12 base58 characters). Conversations are Tier 2: their ids are
 * never in a URL or link, only in our own client's calls to our own server actions, so this is a sanity check on the call,
 * not the URL validation `isId` (lib/ids.ts) does for ids people can see.
 */
export function isConversationId(value: unknown): value is string {
  return typeof value === "string" && /^conv_[1-9A-HJ-NP-Za-km-z]{12}$/.test(value);
}
export function isMessageDirection(value: unknown): value is MessageDirection {
  return typeof value === "string" && (MESSAGE_DIRECTIONS as readonly string[]).includes(value);
}

/** What a conversation needs from her. */
export type ConversationStatus = "needs_reply" | "waiting" | "gone_quiet" | "closed";

export const CONVERSATION_STATUS_LABELS: Record<ConversationStatus, string> = {
  needs_reply: "Needs your reply",
  waiting: "Waiting on them",
  gone_quiet: "Gone quiet",
  closed: "Closed",
};

/** The slice of a conversation its status follows from. */
export type ConversationTimes = {
  opened_at: string;
  closed_at: string | null;
  last_staff_message_at: string | null;
  last_member_message_at: string | null;
};

const MS_PER_DAY = 86_400_000;

/** The latest moment either side wrote, or when it was opened if nobody has been logged yet. */
export function lastActivityAt(c: ConversationTimes): string {
  return [c.opened_at, c.last_staff_message_at, c.last_member_message_at].filter((t): t is string => !!t).reduce((a, b) => (b > a ? b : a));
}

/**
 * The status that follows from who spoke last:
 * - closed: she closed it;
 * - needs your reply: the member wrote last, however long ago (the longer, the more it needs her);
 * - waiting on them: she wrote last (or opened it), and the quiet window has not passed since;
 * - gone quiet: more than `quietDays` days with nothing from either side.
 * A conversation nobody has logged a message in counts from when it was opened. Timestamps are ISO instants, so the
 * comparison is on the instant, not on a calendar day in any zone.
 */
export function conversationStatus(c: ConversationTimes, now: Date, quietDays: number = CONVERSATION_QUIET_DAYS): ConversationStatus {
  if (c.closed_at) return "closed";
  const member = c.last_member_message_at ? Date.parse(c.last_member_message_at) : null;
  const staff = c.last_staff_message_at ? Date.parse(c.last_staff_message_at) : null;
  if (member !== null && (staff === null || member > staff)) return "needs_reply";
  const last = Date.parse(lastActivityAt(c));
  return now.getTime() - last > quietDays * MS_PER_DAY ? "gone_quiet" : "waiting";
}

/** The order the list shows: what needs her first, then what has gone quiet, then who she is waiting on, closed last. */
const STATUS_RANK: Record<ConversationStatus, number> = { needs_reply: 0, gone_quiet: 1, waiting: 2, closed: 3 };

/**
 * Sorts for the list: by status, then the one waiting longest first (an open conversation by its last activity,
 * oldest first; a closed one by when it closed, newest first), then by id so the order never shuffles.
 */
export function sortConversations<T extends ConversationTimes & { id: string }>(rows: readonly T[], now: Date, quietDays: number = CONVERSATION_QUIET_DAYS): T[] {
  return rows
    .map((row) => ({ row, status: conversationStatus(row, now, quietDays) }))
    .sort((a, b) => {
      if (a.status !== b.status) return STATUS_RANK[a.status] - STATUS_RANK[b.status];
      if (a.status === "closed") {
        const x = a.row.closed_at ?? "";
        const y = b.row.closed_at ?? "";
        if (x !== y) return x < y ? 1 : -1;
      } else {
        const x = lastActivityAt(a.row);
        const y = lastActivityAt(b.row);
        if (x !== y) return x < y ? -1 : 1;
      }
      return a.row.id < b.row.id ? -1 : a.row.id > b.row.id ? 1 : 0;
    })
    .map(({ row }) => row);
}

/** A day (YYYY-MM-DD) in the organization's timezone: the day a follow-up date is compared with. */
export function orgDay(now: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: ORG_TIMEZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

/** Whether a follow-up date (a plain day) has come: today or earlier in the organization's timezone. */
export function isFollowUpDue(followUpOn: string | null, now: Date): boolean {
  return followUpOn !== null && followUpOn <= orgDay(now);
}

/** Whole days from `iso` to `now`, never negative. */
export function daysSince(iso: string, now: Date): number {
  return Math.max(0, Math.floor((now.getTime() - Date.parse(iso)) / MS_PER_DAY));
}

/** "today", "yesterday" or "5 days ago": how long ago an instant was, for the list. */
export function daysAgoLabel(iso: string, now: Date): string {
  const days = daysSince(iso, now);
  return days === 0 ? "today" : days === 1 ? "yesterday" : `${days} days ago`;
}
