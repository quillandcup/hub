/**
 * "Last in the community" for Hedgie Care (docs/HEDGIE_CARE.md): the latest thing a member did themselves anywhere in the
 * Hedgie House. One pure module, so the set of what counts is in one place and the repository, the page and the tests all
 * take it from here.
 *
 * What counts is read from the activity log (`member_activities`, docs/ACTIVITY_AND_AUDIT_LOG.md), by its two columns:
 * - **`actor_kind = 'member'`**: the member did it. Staff rows (care, outreach, sudo, a commitment an admin made while viewing
 *   as the member) and system rows (email events) never count.
 * - **a type in `PARTICIPATION`**: something done in the community. Left out on purpose: `hedgie_hub_login` (signing in is
 *   not taking part), `feedback_submitted` (a note to staff, not to the community), and the `*_cleared` rows (taking a
 *   check-in back is not taking part).
 * A new kind of member activity does not count until it is listed here, so the answer never quietly grows to include
 * something nobody chose.
 */

/** Each activity type that counts, with how it reads after "Last in the community: <date>, ". */
export const PARTICIPATION: Readonly<Record<string, string>> = {
  prickle_attended: "a prickle",
  slack_message: "a Slack message",
  slack_thread_reply: "a Slack message",
  slack_reaction: "a Slack reaction",
  prickle_checkin: "a prickle check-in",
  prickle_checkin_updated: "a prickle check-in",
  prickle_checkout: "a prickle check-out",
  prickle_checkout_updated: "a prickle check-out",
  prickle_commitment_created: "a prickle commitment",
  lesson_watched: "a lesson",
  lesson_completed: "a lesson",
  writing_progress_logged: "a writing log",
};

export const PARTICIPATION_TYPES: readonly string[] = Object.keys(PARTICIPATION);

/** The slice of an activity that decides. */
export type ParticipationRow = { member_id: string; activity_type: string; actor_kind: string; occurred_at: string };

/** A member's latest participation: when, the activity type, and what it reads as. */
export type Participation = { occurredAt: string; type: string; label: string };

/** Whether this activity is the member taking part in the community. */
export function isParticipation(row: Pick<ParticipationRow, "activity_type" | "actor_kind">): boolean {
  return row.actor_kind === "member" && Object.prototype.hasOwnProperty.call(PARTICIPATION, row.activity_type);
}

/** The latest participation of each member among these rows (rows that do not count are ignored); a member with none is absent. */
export function latestParticipation(rows: readonly ParticipationRow[]): Map<string, Participation> {
  const latest = new Map<string, Participation>();
  for (const row of rows) {
    if (!isParticipation(row)) continue;
    const seen = latest.get(row.member_id);
    const at = Date.parse(row.occurred_at);
    // A tie goes to the type that sorts first, so the answer does not depend on the order the rows came in.
    if (!seen || at > Date.parse(seen.occurredAt) || (at === Date.parse(seen.occurredAt) && row.activity_type < seen.type)) {
      latest.set(row.member_id, { occurredAt: row.occurred_at, type: row.activity_type, label: PARTICIPATION[row.activity_type] });
    }
  }
  return latest;
}
