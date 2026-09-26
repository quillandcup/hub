import type { SupabaseClient } from "@supabase/supabase-js";
import { addMonthsClamped } from "@/lib/member-tenure";

// Business rule: we don't invite people to host until they've been a member
// for a full calendar month. Wherever the app invites, suggests, or accepts
// self-signups from potential hosts, gate it on getHostEligibility below.
export const HOST_ELIGIBILITY_MIN_MONTHS = 1;

// "Today" for the rule is the org-local calendar date, so a member becomes
// eligible at local midnight on their eligibility date, not at UTC midnight.
const ORG_TIMEZONE = "America/New_York";

export interface HostEligibilityMember {
  firstJoinedAt: string | null; // members.first_joined_at (date-only)
  mostRecentJoinedAt: string | null; // members.most_recent_joined_at (date-only)
}

export interface HostEligibility {
  eligible: boolean;
  // Date-only date the month is counted from, or null when the member has no
  // join date on record.
  tenureStartDate: string | null;
  // Date-only first day the member is eligible, or null when unknown.
  eligibleOn: string | null;
}

function toDateOnly(value: string): string {
  return value.slice(0, 10);
}

// The month counts from the member's FIRST join. Someone rejoining after a
// cancellation or hiatus -- however long ago -- isn't new to the community, so
// they don't wait another month. most_recent_joined_at is only a fallback for
// rows with no first_joined_at.
export function hostingTenureStartDate(member: HostEligibilityMember): string | null {
  const start = member.firstJoinedAt ?? member.mostRecentJoinedAt;
  return start ? toDateOnly(start) : null;
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

// Friendly member-facing explanation for someone who isn't eligible yet.
export function hostEligibilityMessage(eligibility: HostEligibility): string {
  const base = "We invite hedgies to host once they've been a member for a full month";
  if (!eligibility.eligibleOn) return `${base}.`;
  const date = new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${eligibility.eligibleOn}T00:00:00Z`));
  return `${base} — for you, that's ${date}.`;
}

interface HostEligibilityMemberRow {
  id: string;
  first_joined_at: string | null;
  most_recent_joined_at: string | null;
}

// Loads join dates for the given members and computes each one's host
// eligibility. Members not found are omitted from the result.
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
  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += ID_CHUNK) chunks.push(ids.slice(i, i + ID_CHUNK));

  const responses = await Promise.all(
    chunks.map((chunk) =>
      supabase.from("members").select("id, first_joined_at, most_recent_joined_at").in("id", chunk)
    )
  );

  for (const res of responses) {
    if (res.error) throw res.error;
    for (const m of (res.data ?? []) as HostEligibilityMemberRow[]) {
      result.set(
        m.id,
        getHostEligibility({ firstJoinedAt: m.first_joined_at, mostRecentJoinedAt: m.most_recent_joined_at }, now)
      );
    }
  }
  return result;
}
