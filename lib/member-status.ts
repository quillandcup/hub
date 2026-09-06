import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchMembershipHistory } from "@/lib/kajabi/membership-history";
import { buildMembershipTimeline } from "@/lib/membership-timeline";

export type MemberStatus = "lead" | "active" | "on_hiatus" | "cancelled";

// members.status is a cached column, normally kept correct only by the full
// /api/process/members reprocess (reprocess_members_atomic). Admin actions
// that write directly to Local tables (member_hiatus_history,
// member_status_overrides) don't run that job, so without this the Status
// badge on the member detail page goes stale the moment a hiatus is
// started/ended/deleted through the UI (it shows "on hiatus" long after a
// "Return Early" has ended it, for example).
//
// This mirrors reprocess_members_atomic's priority (hiatus > active
// override/program > real Kajabi stint > lead/cancelled), but scoped to one
// member, by reusing buildMembershipTimeline — the same engine that already
// renders the live, correct Membership Timeline on that page — instead of
// duplicating its state-priority rules. Call after any write to hiatus/
// override/program-enrollment tables for a member so the cached column
// doesn't drift.
export async function recomputeMemberStatus(
  supabase: SupabaseClient,
  memberId: string
): Promise<MemberStatus | null> {
  const { data: member } = await supabase
    .from("members")
    .select("id, email, staff_role, status")
    .eq("id", memberId)
    .single();
  if (!member) return null;

  let status: MemberStatus;

  if (member.staff_role) {
    // Staff are always active regardless of subscription/hiatus state (see
    // reprocess_members_atomic's staff_role handling).
    status = "active";
  } else {
    const [{ data: emailAliasRows }, { data: hiatusRows }, { data: enrollmentRows }, { data: overrideRows }] =
      await Promise.all([
        supabase.from("member_email_aliases").select("alias_email").eq("canonical_email", member.email),
        supabase
          .from("member_hiatus_history")
          .select("id, start_date, end_date, reason, notes")
          .eq("member_id", memberId),
        supabase
          .from("member_program_enrollments")
          .select("id, cohort:program_cohorts(starts_at, expires_at, program:programs(name))")
          .eq("member_id", memberId),
        supabase
          .from("member_status_overrides")
          .select("id, override_type, reason, starts_at, expires_at")
          .eq("member_id", memberId),
      ]);

    const allEmails = [member.email, ...(emailAliasRows ?? []).map((a: any) => a.alias_email)];
    const { data: kajabiCustomers } = await supabase
      .schema("bronze")
      .from("kajabi_customers")
      .select("kajabi_customer_id")
      .in("email", allEmails);
    const customerIds = (kajabiCustomers ?? []).map((c: any) => c.kajabi_customer_id).filter(Boolean);
    const membershipHistory = await fetchMembershipHistory(supabase, customerIds);

    const programOverrides = (enrollmentRows ?? []).map((row: any) => ({
      id: row.id,
      starts_at: row.cohort.starts_at,
      expires_at: row.cohort.expires_at,
      reason: row.cohort.program.name,
    }));

    const segments = buildMembershipTimeline(membershipHistory, hiatusRows ?? [], programOverrides, overrideRows ?? []);
    const now = Date.now();
    const current = segments.find(
      (s) => s.startDate.getTime() <= now && (s.endDate === null || s.endDate.getTime() > now)
    );

    if (current?.state === "hiatus") status = "on_hiatus";
    else if (current?.state === "active") status = "active";
    // A lapsed real subscription or a lapsed program-only enrollment both
    // count as "was a member, left" (Step 4c) rather than "never subscribed".
    else status = membershipHistory.length > 0 || programOverrides.length > 0 ? "cancelled" : "lead";
  }

  if (member.status !== status) {
    await supabase.from("members").update({ status, updated_at: new Date().toISOString() }).eq("id", memberId);
  }
  return status;
}
