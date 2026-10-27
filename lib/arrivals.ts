import { createRepos } from "@/lib/data/repos";
import type { SupabaseClient } from "@supabase/supabase-js";
import { buildAliasMap, resolveEmail } from "@/lib/email-aliases";
import { fetchMembershipHistory } from "@/lib/kajabi/membership-history";
import { isMembershipOffer } from "@/lib/membership";
import { buildMembershipTimeline, type TimelineSegment } from "@/lib/membership-timeline";
import { fetchAllBronzeRows } from "@/lib/supabase/bronze-pagination";
import { fetchTrialWindows, pickTrialWindow } from "@/lib/trial-window";

// Who just arrived: the new members who each get a big sister. Nobody types a start date. An
// arrival is found in the data:
//
// - a membership subscription created in Kajabi (a trial if Stripe says it has one, otherwise a
//   direct sign-up), or
// - a cohort starting for someone enrolled in a program that includes membership (180 Program,
//   Ready Writers; not Self-Editing Academy, which doesn't).
//
// Either way it only counts when they weren't a member the day before: someone rejoining after time
// away is new again, but a renewal, a plan change, a hiatus ending or a program joined while already
// a member is not. A trial is never assumed: only a Stripe subscription that shows one is a trial.

export type ArrivalKind = "trial" | "direct" | "program";

export interface Arrival {
  memberId: string;
  memberName: string;
  /** YYYY-MM-DD: the sign-up, or the cohort's start. */
  arrivedOn: string;
  kind: ArrivalKind;
  /** YYYY-MM-DD, from Stripe, for a trial. */
  trialEndsOn: string | null;
  /** The program, for a program arrival. */
  programName: string | null;
}

const MS_PER_DAY = 86_400_000;

function dayMs(dateOnly: string): number {
  return Date.parse(`${dateOnly.slice(0, 10)}T00:00:00Z`);
}

/** Whether a membership timeline covers `instant` with a member state (active or on hiatus). */
export function wasMemberAt(segments: TimelineSegment[], instant: number): boolean {
  return segments.some(
    (s) =>
      (s.state === "active" || s.state === "hiatus") &&
      s.startDate.getTime() <= instant &&
      (s.endDate === null || s.endDate.getTime() > instant)
  );
}

/** One arrival per member: the earliest, and a membership subscription beats a program when both
 * landed on the same member (the subscription says whether there was a trial). */
export function mergeArrivals(candidates: Arrival[]): Arrival[] {
  const rank = (a: Arrival) => (a.kind === "program" ? 1 : 0);
  const best = new Map<string, Arrival>();
  for (const c of candidates) {
    const current = best.get(c.memberId);
    if (!current || c.arrivedOn < current.arrivedOn || (c.arrivedOn === current.arrivedOn && rank(c) < rank(current))) {
      best.set(c.memberId, c);
    }
  }
  return [...best.values()].sort((a, b) => a.arrivedOn.localeCompare(b.arrivedOn) || a.memberName.localeCompare(b.memberName));
}

interface Candidate {
  memberId: string;
  memberName: string;
  email: string;
  arrivedOn: string;
  from: "membership" | "program";
  programName: string | null;
}

/** Membership subscription purchases created on or after `sinceDate`, as candidates by member. */
async function membershipCandidates(supabase: SupabaseClient, sinceDate: string): Promise<Candidate[]> {
  const purchases = (await fetchAllBronzeRows(
    supabase,
    "kajabi_purchases",
    "kajabi_customer_id, kajabi_offer_id, created_at_kajabi",
    (q) => q.gte("created_at_kajabi", `${sinceDate}T00:00:00Z`)
  )) as { kajabi_customer_id: string | null; kajabi_offer_id: string | null; created_at_kajabi: string | null }[];
  if (purchases.length === 0) return [];

  const offerIds = [...new Set(purchases.map((p) => p.kajabi_offer_id).filter((id): id is string => !!id))];
  const customerIds = [...new Set(purchases.map((p) => p.kajabi_customer_id).filter((id): id is string => !!id))];
  if (offerIds.length === 0 || customerIds.length === 0) return [];

  const [offers, customers, aliasRows] = await Promise.all([
    fetchAllBronzeRows(supabase, "kajabi_offers", "kajabi_offer_id, name, data", (q) =>
      q.in("kajabi_offer_id", offerIds)
    ),
    fetchAllBronzeRows(supabase, "kajabi_customers", "kajabi_customer_id, email", (q) =>
      q.in("kajabi_customer_id", customerIds)
    ),
    createRepos(supabase).aliases.emailAliases(),
  ]);

  // The same first two tests as isRealMembershipStint: a subscription offer that is the membership
  // (so a course or program offer, which has no membership, never counts).
  const membershipOfferIds = new Set(
    (offers as { kajabi_offer_id: string; name: string | null; data: { attributes?: { subscription?: boolean } } | null }[])
      .filter((o) => o.data?.attributes?.subscription === true && isMembershipOffer(o.name ?? ""))
      .map((o) => o.kajabi_offer_id)
  );
  const aliasMap = buildAliasMap(aliasRows);
  const emailByCustomer = new Map<string, string>();
  for (const c of customers as { kajabi_customer_id: string; email: string | null }[]) {
    if (c.email) emailByCustomer.set(c.kajabi_customer_id, resolveEmail(c.email, aliasMap));
  }

  const startByEmail = new Map<string, string>();
  for (const p of purchases) {
    if (!p.kajabi_offer_id || !membershipOfferIds.has(p.kajabi_offer_id)) continue;
    const email = p.kajabi_customer_id ? emailByCustomer.get(p.kajabi_customer_id) : undefined;
    if (!email || !p.created_at_kajabi) continue;
    const arrivedOn = p.created_at_kajabi.slice(0, 10);
    const earlier = startByEmail.get(email);
    if (!earlier || arrivedOn < earlier) startByEmail.set(email, arrivedOn);
  }

  const emails = [...startByEmail.keys()];
  const found: Candidate[] = [];
  for (const m of await createRepos(supabase).members.byEmails(emails)) {
    const arrivedOn = startByEmail.get(m.email.toLowerCase());
    if (arrivedOn && !m.staffRole) {
      found.push({ memberId: m.id, memberName: m.name, email: m.email, arrivedOn, from: "membership", programName: null });
    }
  }
  return found;
}

interface EnrollmentRow {
  member_id: string;
  program_cohorts: { starts_at: string; programs: { name: string; includes_membership: boolean } | { name: string; includes_membership: boolean }[] };
  members: { id: string; name: string; email: string; staff_role: string | null } | { id: string; name: string; email: string; staff_role: string | null }[] | null;
}

/** Cohorts of programs that include membership that started in [sinceDate, today], by enrolled member. */
async function programCandidates(supabase: SupabaseClient, sinceDate: string, today: string): Promise<Candidate[]> {
  const { data } = await supabase
    .from("member_program_enrollments")
    .select(
      "member_id, program_cohorts!inner(starts_at, programs!inner(name, includes_membership)), members(id, name, email, staff_role)"
    )
    .gte("program_cohorts.starts_at", sinceDate)
    .lte("program_cohorts.starts_at", today)
    .eq("program_cohorts.programs.includes_membership", true);

  const found: Candidate[] = [];
  for (const row of (data ?? []) as unknown as EnrollmentRow[]) {
    const member = Array.isArray(row.members) ? row.members[0] : row.members;
    const program = Array.isArray(row.program_cohorts.programs) ? row.program_cohorts.programs[0] : row.program_cohorts.programs;
    if (!member || member.staff_role) continue;
    found.push({
      memberId: member.id,
      memberName: member.name,
      email: member.email,
      arrivedOn: row.program_cohorts.starts_at.slice(0, 10),
      from: "program",
      programName: program?.name ?? null,
    });
  }
  return found;
}

/**
 * Was this member already a member the day before `arrivedOn`? Built from the same sources as their
 * membership timeline (Kajabi stints, hiatuses, programs that include membership, gift and direct
 * Stripe overrides), leaving out whatever began on or after the arrival itself, which is the
 * arrival and not a reason they were already here.
 */
async function wasAlreadyMember(supabase: SupabaseClient, c: Candidate): Promise<boolean> {
  const cutoff = dayMs(c.arrivedOn) - MS_PER_DAY;
  const [aliasRows, { data: hiatusRows }, { data: enrollmentRows }, { data: overrideRows }] = await Promise.all([
    createRepos(supabase).aliases.emailsOf(c.memberId),
    supabase.from("member_hiatus_history").select("id, start_date, end_date, reason, notes").eq("member_id", c.memberId),
    supabase
      .from("member_program_enrollments")
      .select("cohort:program_cohorts(starts_at, expires_at, program:programs(name, includes_membership))")
      .eq("member_id", c.memberId),
    supabase
      .from("member_status_overrides")
      .select("override_type, reason, starts_at, expires_at")
      .eq("member_id", c.memberId),
  ]);

  const emails = [c.email, ...aliasRows.map((a) => a.alias_email)];
  const kajabiCustomers = await fetchAllBronzeRows(supabase, "kajabi_customers", "kajabi_customer_id", (q) =>
    q.in("email", emails)
  );
  const customerIds = (kajabiCustomers as { kajabi_customer_id: string | null }[])
    .map((k) => k.kajabi_customer_id)
    .filter((id): id is string => !!id);
  const stints = (await fetchMembershipHistory(supabase, customerIds)).filter(
    (s) => Date.parse(s.created_at_kajabi) < cutoff
  );

  type Cohort = { starts_at: string; expires_at: string; program: { name: string; includes_membership: boolean } | { name: string; includes_membership: boolean }[] | null };
  const programs = ((enrollmentRows ?? []) as unknown as { cohort: Cohort | Cohort[] | null }[]).flatMap((e) => {
    const cohort = Array.isArray(e.cohort) ? e.cohort[0] : e.cohort;
    const program = cohort && (Array.isArray(cohort.program) ? cohort.program[0] : cohort.program);
    if (!cohort || !program?.includes_membership || dayMs(cohort.starts_at) >= cutoff) return [];
    return [{ starts_at: cohort.starts_at, expires_at: cohort.expires_at, reason: program.name }];
  });
  const overrides = ((overrideRows ?? []) as { override_type: string; reason: string | null; starts_at: string; expires_at: string | null }[]).filter(
    (o) => dayMs(o.starts_at) < cutoff
  );

  const segments = buildMembershipTimeline(stints, hiatusRows ?? [], programs, overrides);
  return wasMemberAt(segments, cutoff);
}

/**
 * New members who arrived between `sinceDate` and `today` (YYYY-MM-DD) and aren't staff, one per
 * member: the earliest arrival, with how they arrived. Doesn't know who has been matched; the
 * caller compares with `mentorships`.
 */
export async function getArrivals(supabase: SupabaseClient, sinceDate: string, today: string): Promise<Arrival[]> {
  const [fromMembership, fromProgram] = await Promise.all([
    membershipCandidates(supabase, sinceDate),
    programCandidates(supabase, sinceDate, today),
  ]);

  // Earliest per member first, so each member is checked once.
  const earliest = new Map<string, Candidate>();
  for (const c of [...fromMembership, ...fromProgram]) {
    const current = earliest.get(c.memberId);
    if (!current || c.arrivedOn < current.arrivedOn || (c.arrivedOn === current.arrivedOn && c.from === "membership")) {
      earliest.set(c.memberId, c);
    }
  }
  const candidates = [...earliest.values()];
  if (candidates.length === 0) return [];

  const away = await Promise.all(candidates.map(async (c) => !(await wasAlreadyMember(supabase, c))));
  const arriving = candidates.filter((_, i) => away[i]);

  const windows = await fetchTrialWindows(
    supabase,
    arriving.filter((c) => c.from === "membership").map((c) => ({ id: c.memberId, email: c.email }))
  );
  return mergeArrivals(
    arriving.map((c): Arrival => {
      if (c.from === "program") {
        return { memberId: c.memberId, memberName: c.memberName, arrivedOn: c.arrivedOn, kind: "program", trialEndsOn: null, programName: c.programName };
      }
      const trial = pickTrialWindow(windows.get(c.memberId) ?? [], c.arrivedOn);
      return {
        memberId: c.memberId,
        memberName: c.memberName,
        arrivedOn: c.arrivedOn,
        kind: trial ? "trial" : "direct",
        trialEndsOn: trial?.end ?? null,
        programName: null,
      };
    })
  );
}
