import type { SupabaseClient } from "@supabase/supabase-js";
import { addMonthsClamped, type HiatusWindow } from "@/lib/member-tenure";

// Business rule: we don't invite people to host until they've been a member
// for a full calendar month. Wherever the app invites, suggests, or flags
// someone as a potential host, gate it on getHostEligibility below.
export const HOST_ELIGIBILITY_MIN_MONTHS = 1;

// "Today" for the rule is the org-local calendar date, so a member becomes
// eligible at local midnight on their eligibility date, not at UTC midnight.
const ORG_TIMEZONE = "America/New_York";

export interface HostEligibilityMember {
  firstJoinedAt: string | null; // members.first_joined_at (date-only)
  mostRecentJoinedAt: string | null; // members.most_recent_joined_at (date-only)
  hiatusWindows: HiatusWindow[]; // from member_hiatus_history (start_date/end_date)
}

export interface HostEligibility {
  eligible: boolean;
  // Date-only start of the membership stint the month is counted from, or null
  // when the member has no join date on record.
  tenureStartDate: string | null;
  // Date-only first day the member is eligible, or null when unknown.
  eligibleOn: string | null;
}

function toDateOnly(value: string): string {
  return value.slice(0, 10);
}

// The date the "full month" is counted from: the start of the current
// membership stint.
//
// - A real cancel -> resubscribe rejoin starts a new stint, so the clock
//   restarts from most_recent_joined_at (they're settling back in).
// - Returning from a hiatus does NOT start a new stint. A hiatus is a pause in
//   an ongoing membership (see computeMemberTenure in lib/member-tenure.ts),
//   but most_recent_joined_at deliberately also resets on a hiatus return to
//   drive the "welcome back" UI. So when most_recent_joined_at is exactly an
//   ended hiatus's end date, fall back to first_joined_at: that member was
//   already a member before pausing and isn't "new".
//   Known approximation: members.* doesn't store the latest *real* rejoin
//   separately, so someone who resubscribed and then went on hiatus within
//   the same month is measured from first_joined_at. That's rare and errs on
//   the side of treating a returning member as established.
export function hostingTenureStartDate(member: HostEligibilityMember): string | null {
  const first = member.firstJoinedAt ? toDateOnly(member.firstJoinedAt) : null;
  const mostRecent = member.mostRecentJoinedAt ? toDateOnly(member.mostRecentJoinedAt) : null;
  if (!mostRecent) return first;
  if (!first) return mostRecent;

  const isHiatusReturn = member.hiatusWindows.some((w) => w.endsAt != null && toDateOnly(w.endsAt) === mostRecent);
  return isHiatusReturn ? first : mostRecent;
}

// Date-only string for `now` in the org timezone.
export function orgLocalDate(now: Date): string {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: ORG_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

// First date the member may be invited to host: tenure start + one calendar
// month, clamped to month end (Jan 31 -> Feb 28, or Feb 29 in a leap year).
export function hostEligibleOnDate(tenureStartDate: string): string {
  const start = new Date(`${toDateOnly(tenureStartDate)}T00:00:00Z`);
  return addMonthsClamped(start, HOST_ELIGIBILITY_MIN_MONTHS).toISOString().slice(0, 10);
}

export function getHostEligibility(member: HostEligibilityMember, now: Date): HostEligibility {
  const tenureStartDate = hostingTenureStartDate(member);
  // No join date on record -> we can't show they've been here a month, so
  // don't invite them (admin views surface this as "join date unknown").
  if (!tenureStartDate) return { eligible: false, tenureStartDate: null, eligibleOn: null };

  const eligibleOn = hostEligibleOnDate(tenureStartDate);
  return { eligible: orgLocalDate(now) >= eligibleOn, tenureStartDate, eligibleOn };
}

export function isEligibleToHost(member: HostEligibilityMember, now: Date): boolean {
  return getHostEligibility(member, now).eligible;
}

interface HostEligibilityMemberRow {
  id: string;
  first_joined_at: string | null;
  most_recent_joined_at: string | null;
}

// Loads join dates + hiatus history for the given members and computes each
// one's host eligibility. Members not found are omitted from the result.
export async function fetchHostEligibilityByMember(
  supabase: SupabaseClient,
  memberIds: string[],
  now: Date
): Promise<Map<string, HostEligibility>> {
  const result = new Map<string, HostEligibility>();
  const ids = [...new Set(memberIds)];
  if (ids.length === 0) return result;

  // .in() filters go in the URL, so chunk to keep requests a sane size.
  const ID_CHUNK = 100;
  const members: HostEligibilityMemberRow[] = [];
  const hiatusByMember = new Map<string, HiatusWindow[]>();
  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += ID_CHUNK) chunks.push(ids.slice(i, i + ID_CHUNK));

  await Promise.all(
    chunks.map(async (chunk) => {
      const [membersRes, hiatusRes] = await Promise.all([
        supabase.from("members").select("id, first_joined_at, most_recent_joined_at").in("id", chunk),
        supabase.from("member_hiatus_history").select("member_id, start_date, end_date").in("member_id", chunk),
      ]);
      if (membersRes.error) throw membersRes.error;
      if (hiatusRes.error) throw hiatusRes.error;
      members.push(...((membersRes.data ?? []) as HostEligibilityMemberRow[]));
      for (const h of (hiatusRes.data ?? []) as { member_id: string; start_date: string; end_date: string | null }[]) {
        const windows = hiatusByMember.get(h.member_id) ?? [];
        windows.push({ startsAt: h.start_date, endsAt: h.end_date });
        hiatusByMember.set(h.member_id, windows);
      }
    })
  );

  for (const m of members) {
    result.set(
      m.id,
      getHostEligibility(
        {
          firstJoinedAt: m.first_joined_at,
          mostRecentJoinedAt: m.most_recent_joined_at,
          hiatusWindows: hiatusByMember.get(m.id) ?? [],
        },
        now
      )
    );
  }
  return result;
}
