import type { SupabaseClient } from "@supabase/supabase-js";
import { buildAliasMap, resolveEmail } from "@/lib/email-aliases";

export interface KajabiCandidate {
  member_id: string;
  member_name: string;
  member_email: string;
  member_status: string;
  // Usually one name, but can be more than one if a member's purchases in
  // this window used more than one matching offer (e.g. regular + alumna).
  offer_names: string[];
  purchase_date: string | null; // earliest matching purchase's created_at_kajabi ?? effective_start_at
  effective_start_at: string | null;
  deactivated_at: string | null;
  // Name of another cohort (same program) the member is already enrolled in,
  // if any — informational only, e.g. a legitimate alumna repeat purchase.
  already_enrolled_elsewhere: string | null;
}

interface CohortWindow {
  id: string;
  starts_at: string;
  expires_at: string;
}

interface ProgramForMatching {
  id: string;
  kajabi_offer_names: string[];
}

function nextDay(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().split("T")[0];
}

/**
 * The single date used to decide which cohort a purchase belongs to:
 * created_at_kajabi (transaction date), falling back to effective_start_at
 * only when created_at_kajabi is null. Deliberately NOT an OR/union of both
 * fields — see findKajabiCandidatesForCohort's doc comment for why unioning
 * them produced false positives (a repeat/alumna purchase's stale
 * effective_start_at can predate the real transaction by years).
 */
export function resolveMatchDate(purchase: {
  created_at_kajabi: string | null;
  effective_start_at?: string | null;
}): string | null {
  return purchase.created_at_kajabi ?? purchase.effective_start_at ?? null;
}

/** Whether `dateStr` falls within [cohort.starts_at, cohort.expires_at], inclusive of both ends. */
export function isDateWithinCohortWindow(
  dateStr: string,
  cohort: { starts_at: string; expires_at: string }
): boolean {
  const ms = new Date(dateStr).getTime();
  const startMs = new Date(`${cohort.starts_at}T00:00:00Z`).getTime();
  const endMsExclusive = new Date(`${nextDay(cohort.expires_at)}T00:00:00Z`).getTime();
  return ms >= startMs && ms < endMsExclusive;
}

/**
 * Finds members whose Kajabi purchase data suggests they belong in this
 * cohort: a purchase of one of the program's known offers, falling inside
 * the cohort's [starts_at, expires_at] window.
 *
 * Matches on created_at_kajabi (transaction date), falling back to
 * effective_start_at only when created_at_kajabi is null — the same
 * precedence lib/kajabi/membership-history.ts already uses (buildMembershipStints:
 * `p.created_at_kajabi ?? p.effective_start_at`). This is a single coalesced
 * date, not an OR across two independent ranges: unioning both fields was
 * tried first and produced false positives — for a repeat/alumna purchase,
 * effective_start_at can reflect original access from a much EARLIER,
 * unrelated cohort (Kajabi doesn't grant a fresh access date for an evergreen
 * course the member never lost access to), which pulled the purchase into
 * the wrong, older cohort's window even though its real transaction date
 * (created_at_kajabi) fell squarely in a different, later cohort. Falling
 * back to effective_start_at only when created_at_kajabi is missing avoids
 * that failure mode while still handling rows with no transaction date.
 *
 * Read-only — does not enroll anyone. Does not filter by purchase.status: a
 * refunded/cancelled purchase is still historical proof the member was in
 * this cohort (same reasoning as reprocess_members_atomic Step 4c treating a
 * lapsed cohort enrollment as a real, bounded window rather than "never
 * happened").
 */
export async function findKajabiCandidatesForCohort(
  supabase: SupabaseClient,
  cohort: CohortWindow,
  program: ProgramForMatching
): Promise<{ candidates: KajabiCandidate[]; offerNamesConfigured: boolean }> {
  if (!program.kajabi_offer_names || program.kajabi_offer_names.length === 0) {
    return { candidates: [], offerNamesConfigured: false };
  }

  const { data: offers, error: offersError } = await supabase
    .schema("bronze")
    .from("kajabi_offers")
    .select("kajabi_offer_id, name")
    .in("name", program.kajabi_offer_names);
  if (offersError) throw offersError;

  const offerNameById = new Map<string, string>();
  for (const o of offers || []) offerNameById.set(o.kajabi_offer_id, o.name);
  const offerIds = Array.from(offerNameById.keys());
  if (offerIds.length === 0) return { candidates: [], offerNamesConfigured: true };

  // Bounded by specific offer IDs (a program's total purchases across every
  // cohort it's ever run, not just this one), so this is still inherently
  // small (dozens to low hundreds, not thousands) — no pagination loop needed
  // here unlike the full-table Bronze reads in app/api/process/members. The
  // date window is applied in JS below (on the coalesced date), not pushed
  // into this query, since PostgREST can't express "COALESCE(a, b) BETWEEN
  // x AND y" as a single-column range filter.
  const { data: allOfferPurchases, error: purchasesError } = await supabase
    .schema("bronze")
    .from("kajabi_purchases")
    .select("kajabi_customer_id, kajabi_offer_id, created_at_kajabi, effective_start_at, deactivated_at")
    .in("kajabi_offer_id", offerIds);
  if (purchasesError) throw purchasesError;

  const purchases = (allOfferPurchases || []).filter((p) => {
    const matchDate = resolveMatchDate(p);
    return matchDate !== null && isDateWithinCohortWindow(matchDate, cohort);
  });
  if (purchases.length === 0) return { candidates: [], offerNamesConfigured: true };

  const customerIds = Array.from(new Set(purchases.map((p) => p.kajabi_customer_id).filter(Boolean)));
  const [{ data: customers, error: customersError }, { data: emailAliases, error: aliasesError }] = await Promise.all([
    supabase.schema("bronze").from("kajabi_customers").select("kajabi_customer_id, email").in("kajabi_customer_id", customerIds),
    supabase.from("member_email_aliases").select("alias_email, canonical_email").eq("active", true),
  ]);
  if (customersError) throw customersError;
  if (aliasesError) throw aliasesError;

  const aliasMap = buildAliasMap(emailAliases || []);
  const emailByCustomerId = new Map<string, string>();
  for (const c of customers || []) {
    if (c.email) emailByCustomerId.set(c.kajabi_customer_id, resolveEmail(c.email, aliasMap));
  }

  const canonicalEmails = Array.from(new Set(Array.from(emailByCustomerId.values())));
  if (canonicalEmails.length === 0) return { candidates: [], offerNamesConfigured: true };

  const { data: members, error: membersError } = await supabase
    .from("members")
    .select("id, name, email, status")
    .in("email", canonicalEmails);
  if (membersError) throw membersError;

  const memberByEmail = new Map((members || []).map((m) => [m.email.toLowerCase(), m]));

  // Group matched purchases by member, keeping the earliest for display and
  // collecting every distinct offer name matched (e.g. regular + alumna
  // offer). Purchases that don't resolve to any existing member are skipped
  // — there's no member row to enroll.
  type Accum = {
    member: { id: string; name: string; email: string; status: string };
    offerNames: Set<string>;
    earliest: { created_at_kajabi: string | null; effective_start_at: string | null; deactivated_at: string | null };
    earliestSortKey: string;
  };
  const byMember = new Map<string, Accum>();

  for (const p of purchases) {
    const email = emailByCustomerId.get(p.kajabi_customer_id);
    if (!email) continue;
    const member = memberByEmail.get(email);
    if (!member) continue;

    const offerName = offerNameById.get(p.kajabi_offer_id) ?? "Unknown offer";
    const sortKey = resolveMatchDate(p) ?? "";

    const existing = byMember.get(member.id);
    if (!existing) {
      byMember.set(member.id, {
        member,
        offerNames: new Set([offerName]),
        earliest: {
          created_at_kajabi: p.created_at_kajabi,
          effective_start_at: p.effective_start_at,
          deactivated_at: p.deactivated_at,
        },
        earliestSortKey: sortKey,
      });
    } else {
      existing.offerNames.add(offerName);
      if (sortKey && (!existing.earliestSortKey || sortKey < existing.earliestSortKey)) {
        existing.earliestSortKey = sortKey;
        existing.earliest = {
          created_at_kajabi: p.created_at_kajabi,
          effective_start_at: p.effective_start_at,
          deactivated_at: p.deactivated_at,
        };
      }
    }
  }

  const memberIds = Array.from(byMember.keys());
  const alreadyElsewhereByMember = await findOtherCohortEnrollments(supabase, program.id, cohort.id, memberIds);

  const candidates: KajabiCandidate[] = Array.from(byMember.values()).map(({ member, offerNames, earliest }) => ({
    member_id: member.id,
    member_name: member.name,
    member_email: member.email,
    member_status: member.status,
    offer_names: Array.from(offerNames),
    purchase_date: resolveMatchDate(earliest),
    effective_start_at: earliest.effective_start_at,
    deactivated_at: earliest.deactivated_at,
    already_enrolled_elsewhere: alreadyElsewhereByMember.get(member.id) ?? null,
  }));

  candidates.sort((a, b) => (a.purchase_date ?? "").localeCompare(b.purchase_date ?? ""));

  return { candidates, offerNamesConfigured: true };
}

async function findOtherCohortEnrollments(
  supabase: SupabaseClient,
  programId: string,
  currentCohortId: string,
  memberIds: string[]
): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  if (memberIds.length === 0) return result;

  const { data: programCohorts, error: cohortsError } = await supabase
    .from("program_cohorts")
    .select("id, name")
    .eq("program_id", programId);
  if (cohortsError) throw cohortsError;

  const otherCohortIds = (programCohorts || []).map((c) => c.id).filter((id) => id !== currentCohortId);
  if (otherCohortIds.length === 0) return result;

  const { data: enrollments, error: enrollmentsError } = await supabase
    .from("member_program_enrollments")
    .select("member_id, cohort_id")
    .in("member_id", memberIds)
    .in("cohort_id", otherCohortIds);
  if (enrollmentsError) throw enrollmentsError;

  const cohortNameById = new Map((programCohorts || []).map((c) => [c.id, c.name]));
  for (const e of enrollments || []) {
    if (!result.has(e.member_id)) {
      result.set(e.member_id, cohortNameById.get(e.cohort_id) ?? "another cohort");
    }
  }
  return result;
}
