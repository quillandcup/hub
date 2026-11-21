import { PARTICIPATION_TYPES } from "@/lib/care-participation";

/**
 * "Activity during this plan" on a Hedgie Care plan card (docs/product/HEDGIE_CARE.md): what one member did while a care plan was
 * running, read from their activity log (`member_activities`) and nothing else. One pure module, so the repository, the action,
 * the card and the tests share the vocabulary and the window.
 *
 * What is listed (and nothing else, so a new kind of activity does not appear until someone chooses it):
 * - the member's own activity, `actor_kind = 'member'`, of the types "last in the community" counts (`PARTICIPATION`: prickles,
 *   Slack and Hub chat messages and reactions, check-ins and check-outs, commitments, lessons, writing logs). Logins are not
 *   taking part and are left out, as are staff and system rows;
 * - the emails the Hub sent them and what they did with them (sent, opened, clicked, bounced), from Resend;
 * - the plan's own care rows (started or renewed, closed, handed over), whenever they happened.
 * Never the text of a message: a chat or Slack row is listed by its title ("Posted in #channel") and its time.
 */

/** The activity types of the emails a member was sent, and what they did with them (`lib/email-events.ts`). */
export const PLAN_EMAIL_TYPES: readonly string[] = ["email_sent", "email_opened", "email_clicked", "email_bounced"];

/** The `source` of the email rows. */
export const PLAN_EMAIL_SOURCE = "resend";

/** The member's own activity types that are listed: the community-participation vocabulary. */
export const PLAN_MEMBER_TYPES: readonly string[] = PARTICIPATION_TYPES;

/**
 * Types whose stored title can carry something the member wrote (a writing project's name), so the list says it in fixed words
 * instead. The rest of the titles are what the Activity Log shows ("Posted in #channel", "Attended a prickle").
 */
const FIXED_LABELS: Readonly<Record<string, string>> = {
  writing_progress_logged: "Logged writing progress",
};

/** What a row reads as in the list: a fixed label for the types that need one, else the title the log keeps. */
export function planActivityLabel(row: { activity_type: string; title: string | null }): string {
  return FIXED_LABELS[row.activity_type] ?? row.title ?? row.activity_type.replace(/_/g, " ");
}

/**
 * The stretch of time a care plan covers: from when it started (included) to when it was closed, or to now while it is open
 * (not included: a thing the instant it closed belongs to what comes after).
 */
export function planActivityWindow(plan: { opened_at: string; closed_at: string | null }, now: Date): { fromIso: string; toIso: string } {
  return { fromIso: new Date(plan.opened_at).toISOString(), toIso: new Date(plan.closed_at ?? now.getTime()).toISOString() };
}

/** Rows per page of the list. */
export const PLAN_ACTIVITY_PAGE_SIZE = 25;
