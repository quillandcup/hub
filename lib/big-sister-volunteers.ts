import { getMemberDisplayName } from "@/lib/member-display-name";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getHostEligibility } from "@/lib/host-eligibility";
import type { MentorshipRow } from "@/lib/mentorship";

// The Big Sister volunteer pool (big_sister_volunteers), like hosts: members who say they're happy
// to look after a new member. Staff still match anyone by hand; the pool is who they see first.

/** Members volunteer under the same rule as hosting: a full month since they first joined
 * (getHostEligibility), so a big sister knows the community. One rule, so changing it for hosts
 * changes it here too. */
export interface VolunteerEligibilityMember {
  firstJoinedAt: string | null;
  mostRecentJoinedAt: string | null;
}

export type VolunteerEligibility =
  | { eligible: true }
  | { eligible: false; eligibleOn: string | null };

export function getVolunteerEligibility(member: VolunteerEligibilityMember, now: Date): VolunteerEligibility {
  const { eligible, eligibleOn } = getHostEligibility(member, now);
  return eligible ? { eligible: true } : { eligible: false, eligibleOn };
}

/** What to tell a member who can't volunteer yet. */
export function volunteerEligibilityMessage(eligibility: Exclude<VolunteerEligibility, { eligible: true }>): string {
  const base = "You can volunteer once you've been a member for a full month";
  if (!eligibility.eligibleOn) return `${base}.`;
  const date = new Date(`${eligibility.eligibleOn}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
  return `${base}: from ${date}.`;
}

export interface Volunteer {
  memberId: string;
  /** Display name; the legal name is in `realName` when it differs. */
  name: string;
  realName?: string;
  note: string | null;
  /** When they volunteered (the row's created_at). */
  volunteeredAt: string;
}

export interface VolunteerSuggestion extends Volunteer {
  /** New members inside their 30 days right now: the program prefers one at a time. */
  openLoad: number;
  /** New members they've been matched with, ever. */
  totalMatches: number;
  /** Start date of their most recent match, or null if they've never had one. */
  lastStartedOn: string | null;
}

/**
 * The volunteers in the order staff should consider them: fewest new members right now first
 * (so nobody gets a second while another is free), then whoever has waited longest since their
 * last match (never matched comes first, earliest volunteer first), then by name.
 */
export function rankVolunteers(volunteers: Volunteer[], matches: MentorshipRow[]): VolunteerSuggestion[] {
  const stats = new Map<string, { open: number; total: number; last: string | null }>();
  for (const m of matches) {
    if (m.status !== "matched") continue;
    const s = stats.get(m.mentorMemberId) ?? { open: 0, total: 0, last: null };
    s.total += 1;
    if (m.active) s.open += 1;
    if (!s.last || m.startedOn > s.last) s.last = m.startedOn;
    stats.set(m.mentorMemberId, s);
  }
  return volunteers
    .map((v) => {
      const s = stats.get(v.memberId);
      return { ...v, openLoad: s?.open ?? 0, totalMatches: s?.total ?? 0, lastStartedOn: s?.last ?? null };
    })
    .sort((a, b) => {
      if (a.openLoad !== b.openLoad) return a.openLoad - b.openLoad;
      if (a.lastStartedOn !== b.lastStartedOn) {
        if (a.lastStartedOn === null) return -1;
        if (b.lastStartedOn === null) return 1;
        return a.lastStartedOn.localeCompare(b.lastStartedOn);
      }
      return a.volunteeredAt.localeCompare(b.volunteeredAt) || a.name.localeCompare(b.name);
    });
}

interface VolunteerDbRow {
  member_id: string;
  note: string | null;
  created_at: string;
  member: { name: string; display_name?: string | null } | { name: string; display_name?: string | null }[] | null;
}

/** Current volunteers (not withdrawn), with names. Paginated per CLAUDE.md. */
export async function getVolunteers(supabase: SupabaseClient): Promise<Volunteer[]> {
  const BATCH_SIZE = 1000;
  const all: VolunteerDbRow[] = [];
  let offset = 0;
  let hasMore = true;
  while (hasMore) {
    const { data: batch } = await supabase
      .from("big_sister_volunteers")
      .select("member_id, note, created_at, member:members(name, display_name)")
      .is("deleted_at", null)
      .order("member_id")
      .range(offset, offset + BATCH_SIZE - 1);
    if (batch && batch.length > 0) {
      all.push(...(batch as unknown as VolunteerDbRow[]));
      offset += batch.length;
      hasMore = batch.length === BATCH_SIZE;
    } else {
      hasMore = false;
    }
  }
  return all.map((r) => {
    const member = Array.isArray(r.member) ? r.member[0] : r.member;
    const shown = member ? getMemberDisplayName(member) : "Unknown member";
    return { memberId: r.member_id, name: shown, realName: member && shown !== member.name ? member.name : undefined, note: r.note, volunteeredAt: r.created_at };
  });
}
