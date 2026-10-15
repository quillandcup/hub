import type { SupabaseClient } from "@supabase/supabase-js";
import { getMemberDisplayName } from "@/lib/member-display-name";
import { NOTE_WINDOW_DAYS, deriveOutcome, isMentorshipActive, type MentorshipKind } from "@/lib/mentorship";

// What a member sees of their own Big Sister matches (dashboard card, /big-sisters). Reads through
// my_mentorships(), which returns only the caller's own matches. A new member learns nothing but who
// their big sister is. A big sister also gets what they need to record why a trial didn't continue:
// whether it did is worked out here, on the server, and only that fact reaches the page.

const MS_PER_DAY = 86_400_000;

/** One person on the other side of a match. */
export interface MentorshipPartner {
  mentorshipId: string;
  memberId: string;
  /** The name the community knows them by. */
  name: string;
  photoUrl: string | null;
  /** The day their membership began; the 30 days run from here. */
  startedOn: string;
  kind: MentorshipKind;
}

/** A new member a big sister is looking after. */
export interface Mentee extends MentorshipPartner {
  /** A trial that didn't continue, still inside the window to say why: show the note box. */
  canRecordReason: boolean;
  /** What the big sister wrote about why, if anything. */
  note: string | null;
}

export interface MyMentorships {
  /** The member's big sister, while their 30 days run. */
  bigSister: MentorshipPartner | null;
  /** New members this member is looking after, newest first. */
  mentees: Mentee[];
}

export interface MyMentorshipRow {
  mentorship_id: string;
  viewer_role: "big_sister" | "new_member";
  other_member_id: string;
  other_name: string;
  other_display_name: string | null;
  other_photo_url: string | null;
  started_on: string;
  trial_ends_on: string | null;
  kind: MentorshipKind;
  outcome_note: string | null;
  other_status: string | null;
  other_first_joined_at: string | null;
  other_most_recent_joined_at: string | null;
}

/** Splits a member's matches into their big sister and the new members they look after, keeping
 * what still shows on `today`: a match for its 30 days, and for a big sister a trial that didn't
 * continue until NOTE_WINDOW_DAYS so they can say why. Pure; getMyMentorships feeds it. */
export function currentMentorships(rows: MyMentorshipRow[], today: string): MyMentorships {
  const result: MyMentorships = { bigSister: null, mentees: [] };
  for (const row of rows) {
    const partner: MentorshipPartner = {
      mentorshipId: row.mentorship_id,
      memberId: row.other_member_id,
      name: getMemberDisplayName({ name: row.other_name, display_name: row.other_display_name }),
      photoUrl: row.other_photo_url,
      startedOn: row.started_on,
      kind: row.kind,
    };
    const active = isMentorshipActive(row.started_on, today);

    if (row.viewer_role === "new_member") {
      if (active) result.bigSister ??= partner;
      continue;
    }

    const didNotContinue =
      row.kind === "trial" &&
      deriveOutcome(
        row.kind,
        row.started_on,
        row.trial_ends_on,
        {
          status: row.other_status,
          firstJoinedAt: row.other_first_joined_at,
          mostRecentJoinedAt: row.other_most_recent_joined_at,
        },
        today
      ).outcome === "not_converted";
    const inNoteWindow = Date.parse(`${today}T00:00:00Z`) < Date.parse(`${row.started_on}T00:00:00Z`) + NOTE_WINDOW_DAYS * MS_PER_DAY;
    const canRecordReason = didNotContinue && inNoteWindow;
    if (!active && !canRecordReason) continue;
    result.mentees.push({ ...partner, canRecordReason, note: row.outcome_note });
  }
  result.mentees.sort((a, b) => b.startedOn.localeCompare(a.startedOn));
  return result;
}

export async function getMyMentorships(
  supabase: SupabaseClient,
  memberId: string,
  today: string
): Promise<MyMentorships> {
  const { data } = await supabase.rpc("my_mentorships", { p_member_id: memberId });
  return currentMentorships((data ?? []) as MyMentorshipRow[], today);
}
